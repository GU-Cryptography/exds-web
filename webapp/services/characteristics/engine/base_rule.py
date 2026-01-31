from abc import ABC, abstractmethod
from typing import Optional, List
from webapp.models.customer import Tag
from .context import LabelingContext

class BaseRule(ABC):
    """
    业务规则抽象基类
    每个规则负责生成 0 或 1 个特定的标签
    """
    
    @property
    @abstractmethod
    def rule_id(self) -> str:
        """规则唯一ID"""
        pass

    @property
    @abstractmethod
    def category(self) -> str:
        """规则分类 (long_term, short_term, anomaly)"""
        pass

    @abstractmethod
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        """
        核心评估逻辑
        :param context: 数据上下文
        :return: Tag 对象 (如果命中) 或 None
        """
        pass

    def create_tag(self, name: str, confidence: float = 1.0, reason: str = None, metadata: dict = None) -> Tag:
        """辅助方法：创建标准 Tag 对象"""
        return Tag(
            name=name,
            source="AUTO",
            confidence=confidence,
            rule_id=self.rule_id,
            reason=reason or f"Matched by {self.rule_id}",
            metadata=metadata or {}
        )
