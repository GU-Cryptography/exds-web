$ErrorActionPreference = "Stop"

git config core.hooksPath .githooks
Write-Host "已设置 Git hooks 路径为 .githooks"
Write-Host "后续提交将自动执行乱码检查与鉴权检查。"
