# 脚本

均可在任意目录执行，脚本会自行定位到仓库根目录。

## dev/ — 本地开发辅助

| 脚本 | 作用 |
|------|------|
| `start-dev.sh` | 启动 Docker 基础设施，再在后台启动后端和前端开发服务器 |
| `restart-all.sh` | 重启 Docker 服务和后端开发服务器 |
| `fix-and-restart.sh` | 停止本项目的 Node 进程、清理后端编译缓存后重启 |
| `init-admin.sh` | 在 Docker 环境中构建后端并初始化管理后台表和默认管理员 |
| `integration-tests.sh` | 用临时的 MySQL 8.0 和 Redis 7 容器（随机本机端口）运行后端全部测试，结束后删除容器；额外参数传给 Jest。Claude Code 中对应 `/integration` |

停止进程时只匹配本仓库 `backend/`、`frontend/` 下的 `node_modules` 路径，不会影响编辑器或其他项目的 Node 进程。

## manual-tests/ — 手工接口检查

对本地运行中的后端（`http://localhost:3001/api`）发起 curl 请求，逐步检查优惠券、收藏、浏览历史等功能，便于人工排查。自动化回归以 `backend` 的 Jest 测试和 `frontend` 的浏览器端到端测试为准。

需要直接查询数据库的脚本通过 `docker exec` 使用容器内的 `MYSQL_ROOT_PASSWORD`，密码不写进脚本。
