import React, { useState, useEffect } from 'react';
import {
    Autocomplete,
    TextField,
    Chip,
    Box,
    Typography,
    Paper,
    Checkbox,
    Button,
    Divider,
    InputAdornment,
    CircularProgress
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { CustomerTag, getCustomerTags } from '../../api/customer';

interface TagFilterProps {
    selectedTags: string[];
    onChange: (tags: string[]) => void;
    onReset?: () => void;
}

interface TagGroup {
    category: string;
    tags: CustomerTag[];
}

/**
 * 标签筛选组件
 * 用于客户列表页的标签筛选，支持多选(OR逻辑)
 */
const TagFilter: React.FC<TagFilterProps> = ({ selectedTags, onChange, onReset }) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [allTags, setAllTags] = useState<CustomerTag[]>([]);
    const [searchText, setSearchText] = useState('');

    // 加载所有标签
    useEffect(() => {
        const loadTags = async () => {
            setLoading(true);
            try {
                const response = await getCustomerTags();
                setAllTags(response.data || []);
            } catch (error) {
                console.error('加载标签失败:', error);
            } finally {
                setLoading(false);
            }
        };
        loadTags();
    }, []);

    // 按分类分组标签
    const groupedTags: TagGroup[] = React.useMemo(() => {
        const groups: Record<string, CustomerTag[]> = {};
        allTags.forEach(tag => {
            const category = tag.category || '其他';
            if (!groups[category]) {
                groups[category] = [];
            }
            groups[category].push(tag);
        });
        return Object.entries(groups).map(([category, tags]) => ({ category, tags }));
    }, [allTags]);

    // 筛选匹配搜索词的标签
    const filteredGroups = React.useMemo(() => {
        if (!searchText.trim()) return groupedTags;
        const lowerSearch = searchText.toLowerCase();
        return groupedTags.map(group => ({
            ...group,
            tags: group.tags.filter(tag =>
                tag.name.toLowerCase().includes(lowerSearch)
            )
        })).filter(group => group.tags.length > 0);
    }, [groupedTags, searchText]);

    const handleTagToggle = (tagName: string) => {
        const newSelection = selectedTags.includes(tagName)
            ? selectedTags.filter(t => t !== tagName)
            : [...selectedTags, tagName];
        onChange(newSelection);
    };

    const handleRemoveTag = (tagName: string) => {
        onChange(selectedTags.filter(t => t !== tagName));
    };

    return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Autocomplete
                multiple
                open={open}
                onOpen={() => setOpen(true)}
                onClose={() => setOpen(false)}
                value={selectedTags}
                onChange={(_, newValue) => onChange(newValue)}
                options={allTags.map(t => t.name)}
                loading={loading}
                disableCloseOnSelect
                renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                        <Chip
                            {...getTagProps({ index })}
                            key={option}
                            label={option}
                            size="small"
                            onDelete={() => handleRemoveTag(option)}
                        />
                    ))
                }
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label="标签筛选"
                        placeholder="选择标签..."
                        size="small"
                        sx={{ minWidth: 200 }}
                        InputProps={{
                            ...params.InputProps,
                            startAdornment: (
                                <>
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" color="action" />
                                    </InputAdornment>
                                    {params.InputProps.startAdornment}
                                </>
                            ),
                            endAdornment: (
                                <>
                                    {loading ? <CircularProgress color="inherit" size={20} /> : null}
                                    {params.InputProps.endAdornment}
                                </>
                            )
                        }}
                    />
                )}
                PaperComponent={({ children, ...props }) => (
                    <Paper
                        {...props}
                        elevation={8}
                        onMouseDown={(e) => e.preventDefault()}
                    >
                        <Box sx={{ p: 1 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="输入以搜索..."
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon fontSize="small" />
                                        </InputAdornment>
                                    )
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.preventDefault()}
                            />
                        </Box>
                        <Divider />
                        <Box
                            sx={{ maxHeight: 300, overflowY: 'auto', p: 1 }}
                            onMouseDown={(e) => e.preventDefault()}
                        >
                            {filteredGroups.map((group) => (
                                <Box key={group.category} sx={{ mb: 1 }}>
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}
                                    >
                                        {group.category}
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {group.tags.map((tag) => {
                                            const isSelected = selectedTags.includes(tag.name);
                                            return (
                                                <Chip
                                                    key={tag.name}
                                                    label={tag.name}
                                                    size="small"
                                                    variant={isSelected ? 'filled' : 'outlined'}
                                                    color={isSelected ? 'primary' : 'default'}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        handleTagToggle(tag.name);
                                                    }}
                                                    icon={
                                                        <Checkbox
                                                            checked={isSelected}
                                                            size="small"
                                                            sx={{ p: 0, mr: -0.5 }}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    }
                                                />
                                            );
                                        })}
                                    </Box>
                                </Box>
                            ))}
                            {filteredGroups.length === 0 && (
                                <Typography variant="body2" color="text.secondary" sx={{ p: 1, textAlign: 'center' }}>
                                    未找到匹配的标签
                                </Typography>
                            )}
                        </Box>
                    </Paper>
                )}
            />
        </Box>
    );
}

export default TagFilter;
