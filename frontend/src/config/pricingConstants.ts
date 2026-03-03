/**
 * 定价配置相关的常量定义
 */

export interface ReferenceTypeOption {
    value: string;
    label: string;
}

interface ReferenceTypeInternalDefinition {
    value: string;
    regularLabel?: string;
    periodLabel?: string;
    isRegular: boolean;
    isPeriod: boolean;
}

/**
 * 零售套餐参考价内部定义
 * 
 * 映射来源：
 * - regularLabel 匹配 webapp/api/v1_retail_prices.py 的 REGULAR_PRICE_KEY_MAP
 * - periodLabel 匹配 frontend/src/pages/tabs/RetailSettlementPriceTab.tsx 的 PERIOD_PRICE_COLS
 */
const REFERENCE_DEFINITIONS: ReferenceTypeInternalDefinition[] = [
    {
        value: 'upper_limit_price',
        regularLabel: '上限价',
        periodLabel: '上限价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'market_monthly_avg',
        regularLabel: '中长期市场月度交易均价（不分时）',
        periodLabel: '中长期市场月度均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'market_annual_avg',
        regularLabel: '中长期市场年度交易均价（不分时）',
        periodLabel: '中长期市场年度均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'market_avg',
        regularLabel: '中长期市场交易均价（不分时）',
        periodLabel: '中长期市场交易均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'market_monthly_on_grid',
        regularLabel: '中长期市场当月平均上网电价',
        periodLabel: '当月平均上网电价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'retailer_monthly_avg',
        regularLabel: '售电公司月度交易均价（不分时）',
        periodLabel: '售电公司月度均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'retailer_annual_avg',
        regularLabel: '售电公司年度交易均价（不分时）',
        periodLabel: '售电公司年度均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'retailer_avg',
        regularLabel: '售电公司交易均价（不分时）',
        periodLabel: '售电公司交易均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'real_time_avg',
        regularLabel: '省内现货实时市场加权平均价',
        periodLabel: '实时市场均价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'day_ahead_avg',
        regularLabel: '目前市场均价（不分时）',
        periodLabel: '日前市场均价',
        isRegular: false,
        isPeriod: true
    },
    {
        value: 'genside_annual_bilateral',
        regularLabel: '发电侧火电年度中长期双边协商交易合同分月平段价',
        periodLabel: '发电侧火电年度双边价',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'grid_agency_price',
        regularLabel: '电网代理购电价格',
        periodLabel: '电网代理购电价格',
        isRegular: true,
        isPeriod: true
    },
    {
        value: 'market_longterm_flat_avg',
        regularLabel: '市场化用户中长期交易平段合同加权平均价',
        isRegular: true,
        isPeriod: false
    },
    {
        value: 'retailer_monthly_settle_weighted',
        regularLabel: '售电公司月度结算加权价',
        isRegular: true,
        isPeriod: false
    },
    {
        value: 'retailer_side_settle_weighted',
        regularLabel: '售电侧月度结算加权价',
        isRegular: true,
        isPeriod: false
    },
    {
        value: 'coal_capacity_discount',
        regularLabel: '煤电容量电费折价',
        isRegular: true,
        isPeriod: false
    },
    // 兼容历史老数据/特殊模型键值
    { value: 'ceiling_price', regularLabel: '上限价', isRegular: true, isPeriod: false },
    { value: 'annual_longterm_time', periodLabel: '售电侧年度中长期分时交易价格', isRegular: false, isPeriod: true },
    { value: 'longterm_time', periodLabel: '售电侧中长期分时交易价格', isRegular: false, isPeriod: true }
];

/**
 * 获取参考价选项（根据分时/不分时执行过滤，并应用对应标签）
 */
export const getReferenceOptions = (isTimeBased: boolean): ReferenceTypeOption[] => {
    return REFERENCE_DEFINITIONS
        .filter(def => isTimeBased ? def.isPeriod : def.isRegular)
        .map(def => ({
            value: def.value,
            label: isTimeBased
                ? `${def.periodLabel || def.regularLabel}（分时）`
                : (def.regularLabel || def.periodLabel || '')
        }));
};

/**
 * 通用的标签映射（用于详情页显示）
 */
export const getReferenceLabel = (value: string, isTimeBased: boolean): string => {
    const def = REFERENCE_DEFINITIONS.find(d => d.value === value);
    if (!def) return value;
    return isTimeBased
        ? `${def.periodLabel || def.regularLabel}（分时）`
        : (def.regularLabel || def.periodLabel || '');
};
