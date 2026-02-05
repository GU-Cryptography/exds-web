# -*- coding: utf-8 -*-
"""
Accuracy Evaluation Service

Provides functionality to calculate and save forecast accuracy metrics against actual data.
Supports various forecast types (price, load, etc.) by specifying collection names and fields.
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
import numpy as np
# pandas imported but not strictly used in the logic provided, keep if needed for future
from pymongo import ASCENDING

from webapp.tools.mongo import DATABASE
from webapp.services.tou_service import get_period_indices_by_date

logger = logging.getLogger(__name__)

def evaluate_forecast_accuracy(
    target_date: datetime,
    forecast_type: str,
    actual_collection: str,
    actual_field: str = 'avg_clearing_price',
    forecast_collection: str = 'price_forecast_results',
    forecast_field: str = 'predicted_price',
    accuracy_collection: str = 'forecast_accuracy_daily',
    customer_id: str = 'system',
    points_per_day: int = 96,
    force_update: bool = False
) -> List[str]:
    """
    Evaluates forecast accuracy for a specific date and saves results to MongoDB.

    Args:
        target_date: The date to evaluate (00:00 to 00:00 next day).
        forecast_type: Type of forecast (e.g., 'd1_price').
        actual_collection: Name of MongoDB collection containing actual values.
        actual_field: Field name for actual values in the collection.
        forecast_collection: Name of MongoDB collection containing forecasts.
        forecast_field: Field name for predicted values.
        accuracy_collection: Name of MongoDB collection to save results.
        customer_id: Customer ID (default: 'system').
        points_per_day: Expected number of data points (default: 96).
        force_update: If True, recalculate even if validation exists.

    Returns:
        List of forecast_ids that were evaluated.
    """
    logger.info(f"Evaluating {forecast_type} accuracy for {target_date.date()}")
    
    # 1. Fetch Actuals
    start_dt = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_dt = (target_date + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    actual_col = DATABASE[actual_collection]
    actual_docs = list(actual_col.find({
        'datetime': {'$gt': start_dt, '$lte': end_dt}
    }).sort('datetime', ASCENDING))

    if len(actual_docs) < points_per_day:
        logger.warning(f"Incomplete actuals for {target_date.date()}: {len(actual_docs)}/{points_per_day}")
        return []

    y_actual = np.array([d.get(actual_field, 0.0) for d in actual_docs[:points_per_day]])

    # 2. Find Forecasts
    forecast_col = DATABASE[forecast_collection]
    forecast_ids = forecast_col.distinct('forecast_id', {
        'target_date': target_date,
        'forecast_type': forecast_type
    })

    if not forecast_ids:
        logger.warning(f"No forecasts found for {target_date.date()} (Type: {forecast_type})")
        return []

    accuracy_col = DATABASE[accuracy_collection]
    evaluated_ids = []

    for forecast_id in forecast_ids:
        # Check existing unless forced
        if not force_update:
            existing = accuracy_col.count_documents({
                'target_date': target_date,
                'forecast_type': forecast_type,
                'forecast_id': forecast_id,
                'customer_id': customer_id
            })
            if existing > 0:
                logger.debug(f"Accuracy for {forecast_id} already exists, skipping")
                continue

        # Fetch prediction
        pred_docs = list(forecast_col.find({
            'target_date': target_date,
            'forecast_type': forecast_type,
            'forecast_id': forecast_id
        }).sort('datetime', ASCENDING))

        if len(pred_docs) < points_per_day:
            logger.warning(f"Incomplete forecast for {forecast_id}: {len(pred_docs)}/{points_per_day}")
            continue

        y_pred = np.array([d.get(forecast_field, 0.0) for d in pred_docs[:points_per_day]])
        
        # Metadata
        model_type = pred_docs[0].get('model_type', 'unknown')
        model_version = pred_docs[0].get('model_version', 'unknown')
        forecast_date = pred_docs[0].get('forecast_date')
        
        # Calculate Metrics
        metrics = calculate_metrics(y_actual, y_pred, target_date)
        
        # Save to DB
        doc = {
            'target_date': target_date,
            'forecast_type': forecast_type,
            'forecast_id': forecast_id,
            'customer_id': customer_id,
            'forecast_date': forecast_date or (target_date - timedelta(days=1)), # Fallback
            'model_type': model_type,
            'model_version': model_version,
            'wmape_accuracy': metrics.get('wmape_accuracy'),
            'mae': metrics.get('mae'),
            'rmse': metrics.get('rmse'),
            'direction_accuracy': metrics.get('direction_accuracy'),
            'r2': metrics.get('r2'),
            'period_accuracy': metrics.get('period_accuracy', {}),
            'stats': {
                'min_value': float(np.min(y_actual)),
                'max_value': float(np.max(y_actual)),
                'mean_value': float(np.mean(y_actual)),
                'has_negative': bool(np.any(y_actual < 0))
            },
            'rate_90_pass': bool(metrics.get('wmape_accuracy', 0) >= 90),
            'rate_85_pass': bool(metrics.get('wmape_accuracy', 0) >= 85),
            'calculated_at': datetime.now()
        }

        # Update or Insert
        accuracy_col.update_one(
            {
                'target_date': target_date,
                'forecast_type': forecast_type,
                'forecast_id': forecast_id,
                'customer_id': customer_id
            },
            {'$set': doc},
            upsert=True
        )
        evaluated_ids.append(forecast_id)
        logger.info(f"Evaluated {forecast_id}: WMAPE Acc={metrics.get('wmape_accuracy', 0):.2f}%")

    return evaluated_ids

def calculate_metrics(y_actual: np.ndarray, y_pred: np.ndarray, target_date: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Core metric calculation logic.
    """
    sum_abs = np.sum(np.abs(y_actual))
    if sum_abs > 0:
        wmape = np.sum(np.abs(y_actual - y_pred)) / sum_abs * 100
        wmape_accuracy = 100 - wmape
    else:
        wmape_accuracy = None

    mae = np.mean(np.abs(y_actual - y_pred))
    rmse = np.sqrt(np.mean((y_actual - y_pred) ** 2))

    # Direction Accuracy
    if len(y_actual) > 1:
        actual_direction = np.sign(np.diff(y_actual))
        pred_direction = np.sign(np.diff(y_pred))
        # Matches if both up (1), both down (-1), or both flat (0)
        direction_accuracy = float(np.mean(actual_direction == pred_direction) * 100)
    else:
        direction_accuracy = None

    # R2
    ss_res = np.sum((y_actual - y_pred) ** 2)
    ss_tot = np.sum((y_actual - np.mean(y_actual)) ** 2)
    r2 = float(1 - (ss_res / ss_tot)) if ss_tot > 0 else None

    # Period Accuracy (TOU)
    period_accuracy = {}
    if target_date:
        try:
            period_indices = get_period_indices_by_date(target_date)
            for period_name, indices in period_indices.items():
                valid_indices = [i for i in indices if i < len(y_actual)]
                if valid_indices:
                    y_p = y_actual[valid_indices]
                    y_f = y_pred[valid_indices]
                    sum_p = np.sum(np.abs(y_p))
                    if sum_p > 0:
                        acc = 100 - np.sum(np.abs(y_p - y_f)) / sum_p * 100
                        period_accuracy[period_name] = float(acc)
        except Exception as e:
            logger.warning(f"Failed to calculate period accuracy: {e}")

    return {
        'wmape_accuracy': float(wmape_accuracy) if wmape_accuracy is not None else None,
        'mae': float(mae),
        'rmse': float(rmse),
        'direction_accuracy': direction_accuracy,
        'r2': r2,
        'period_accuracy': period_accuracy
    }
