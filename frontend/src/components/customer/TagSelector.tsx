import React, { useState, useEffect } from 'react';
import {
    Box,
    Chip,
    IconButton,
    Popover,
    TextField,
    Typography,
    Divider,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Button,
    InputAdornment,
    CircularProgress,
    Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { Tag, CustomerTag, getCustomerTags, createCustomerTag } from '../../api/customer';

interface TagSelectorProps {
    tags: Tag[];
    onChange: (tags: Tag[]) => void;
    readonly?: boolean;
}

interface TagGroup {
    category: string;
    tags: CustomerTag[];
}

/**
 * 标签选择器组件 (编辑弹窗用)
 * 支持添加已有标签和创建新标签
 */
const TagSelector: React.FC<TagSelectorProps> = ({ tags, onChange, readonly = false }) => {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [loading, setLoading] = useState(false);
    const [allTags, setAllTags] = useState<CustomerTag[]>([]);
    const [searchText, setSearchText] = useState('');
    const [creating, setCreating] = useState(false);

    const open = Boolean(anchorEl);

    // 加载所有可用标签
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

    // 按分类分组
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

    // 筛选匹配的标签
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

    // 检查搜索词是否已存在于标签库
    const tagExists = React.useMemo(() => {
        if (!searchText.trim()) return true;
        return allTags.some(t => t.name.toLowerCase() === searchText.toLowerCase());
    }, [allTags, searchText]);

    // 已选标签名称集合
    const selectedTagNames = new Set(tags.map(t => t.name));

    const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
        setSearchText('');
    };

    const handleClose = () => {
        setAnchorEl(null);
        setSearchText('');
    };

    const handleAddTag = (tagName: string) => {
        if (selectedTagNames.has(tagName)) return;

        const newTag: Tag = {
            name: tagName,
            source: 'MANUAL',
            expire: null,
            reason: null
        };
        onChange([...tags, newTag]);
    };

    const handleRemoveTag = (tagName: string) => {
        onChange(tags.filter(t => t.name !== tagName));
    };

    const handleCreateAndAdd = async () => {
        if (!searchText.trim() || tagExists) return;

        setCreating(true);
        try {
            // 创建新标签到数据库
            await createCustomerTag({ name: searchText.trim() });
            // 添加到当前客户
            handleAddTag(searchText.trim());
            // 刷新标签列表
            const response = await getCustomerTags();
            setAllTags(response.data || []);
            setSearchText('');
        } catch (error) {
            console.error('创建标签失败:', error);
        } finally {
            setCreating(false);
        }
    };

    const getTagColor = (source: string) => {
        return source === 'AUTO' ? 'secondary' : 'primary';
    };

    return (
        <Box>
            {/* 已选标签列表 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                {tags.map((tag) => (
                    <Tooltip
                        key={tag.name}
                        title={`来源: ${tag.source === 'AUTO' ? '算法' : '人工'}${tag.reason ? ` | ${tag.reason}` : ''}`}
                    >
                        <Chip
                            label={tag.name}
                            size="small"
                            color={getTagColor(tag.source)}
                            variant="filled"
                            onDelete={readonly ? undefined : () => handleRemoveTag(tag.name)}
                        />
                    </Tooltip>
                ))}

                {!readonly && (
                    <IconButton
                        size="small"
                        onClick={handleOpen}
                        sx={{
                            border: '1px dashed',
                            borderColor: 'divider',
                            borderRadius: 1,
                            px: 1
                        }}
                    >
                        <AddIcon fontSize="small" />
                        <Typography variant="caption" sx={{ ml: 0.5 }}>添加</Typography>
                    </IconButton>
                )}
            </Box>

            {/* 标签选择弹窗 */}
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                PaperProps={{ sx: { width: 300, maxHeight: 400 } }}
            >
                <Box sx={{ p: 1.5 }}>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="输入以搜索或新建..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        autoFocus
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" />
                                </InputAdornment>
                            )
                        }}
                    />
                </Box>

                <Divider />

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : (
                    <Box sx={{ maxHeight: 250, overflowY: 'auto' }}>
                        {filteredGroups.map((group) => (
                            <Box key={group.category}>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ px: 2, py: 0.5, fontWeight: 'bold', display: 'block', bgcolor: 'action.hover' }}
                                >
                                    {group.category}
                                </Typography>
                                <List dense disablePadding>
                                    {group.tags.map((tag) => {
                                        const isSelected = selectedTagNames.has(tag.name);
                                        return (
                                            <ListItem key={tag.name} disablePadding>
                                                <ListItemButton
                                                    onClick={() => handleAddTag(tag.name)}
                                                    disabled={isSelected}
                                                    sx={{ py: 0.5 }}
                                                >
                                                    <ListItemText
                                                        primary={tag.name}
                                                        primaryTypographyProps={{
                                                            variant: 'body2',
                                                            color: isSelected ? 'text.disabled' : 'text.primary'
                                                        }}
                                                    />
                                                    {isSelected && (
                                                        <Typography variant="caption" color="text.disabled">已添加</Typography>
                                                    )}
                                                </ListItemButton>
                                            </ListItem>
                                        );
                                    })}
                                </List>
                            </Box>
                        ))}

                        {filteredGroups.length === 0 && searchText.trim() && (
                            <Box sx={{ p: 2, textAlign: 'center' }}>
                                <Typography variant="body2" color="text.secondary" gutterBottom>
                                    未找到匹配的标签
                                </Typography>
                            </Box>
                        )}
                    </Box>
                )}

                {/* 创建新标签按钮 */}
                {searchText.trim() && !tagExists && (
                    <>
                        <Divider />
                        <Box sx={{ p: 1 }}>
                            <Button
                                fullWidth
                                variant="outlined"
                                size="small"
                                startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
                                onClick={handleCreateAndAdd}
                                disabled={creating}
                            >
                                ➕ 新建标签: "{searchText.trim()}"
                            </Button>
                        </Box>
                    </>
                )}
            </Popover>
        </Box>
    );
};

export default TagSelector;
