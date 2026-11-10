#!/usr/bin/env bash
# ============================================================================
#  轻聊 chatWB20261103 —— 阿里云 ECS 一键部署脚本
# ----------------------------------------------------------------------------
#  适用：Ubuntu / 阿里云 ECS（已 root 登录）
#  用法：把本文件传到服务器后执行  bash deploy.sh
#  说明：脚本会自动安装 Node.js 22、拉取代码、注册为系统服务并启动。
#        应用直接监听 80 端口，无需 Nginx。代码来自 GitHub 公开仓库，
#        国内网络自动走镜像，拉不到会明确提示。
# ============================================================================
set -e

echo "===== 轻聊 部署开始 ====="

# 1) 基础工具
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y -q git curl xz-utils ufw

# 2) 安装 Node.js 22（node:sqlite 需要 22.5+），使用国内镜像 npmmirror
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  NODE_VER=22.22.2
  echo ">> 下载 Node.js ${NODE_VER} (npmmirror)"
  curl -fsSL "https://registry.npmmirror.com/-/binary/node/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local
  ln -sfn /usr/local/node-v${NODE_VER}-linux-x64 /usr/local/node22
  ln -sfn /usr/local/node22/bin/node /usr/local/bin/node
  ln -sfn /usr/local/node22/bin/npm  /usr/local/bin/npm
  ln -sfn /usr/local/node22/bin/npx  /usr/local/bin/npx
fi
echo ">> Node 版本: $(node -v)"

# 3) 拉取代码（官方优先，失败自动换国内镜像）
cd /opt
rm -rf chat-system
CLONED=0
for U in \
  "https://github.com/lantianyi0728/chat-system.git" \
  "https://ghproxy.com/https://github.com/lantianyi0728/chat-system.git" \
  "https://gitclone.com/github.com/lantianyi0728/chat-system.git" \
  "https://mirror.ghproxy.com/https://github.com/lantianyi0728/chat-system.git" ; do
  echo ">> 尝试: $U"
  if git clone --depth 1 "$U" chat-system >/dev/null 2>&1; then echo ">> 成功: $U"; CLONED=1; break; fi
done
if [ "$CLONED" -ne 1 ]; then
  echo "!! 代码拉取失败（GitHub 不可达）。请手动把项目文件夹传到 /opt/chat-system 后重跑本脚本。"
  exit 1
fi
cd /opt/chat-system
mkdir -p data

# 4) systemd 服务：Node 直接监听 80 端口（省去 Nginx，最简单）
cat > /etc/systemd/system/chat.service <<'EOF'
[Unit]
Description=轻聊聊天服务
After=network.target

[Service]
WorkingDirectory=/opt/chat-system
ExecStart=/usr/local/bin/node /opt/chat-system/server.js
Restart=always
Environment=PORT=80
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now chat

# 5) 本机防火墙放行
ufw allow 80/tcp 2>/dev/null || true
ufw allow 8000/tcp 2>/dev/null || true

# 6) 健康检查
sleep 3
echo "===== 健康检查 ====="
curl -s -o /dev/null -w "  本机 http://127.0.0.1/  -> %{http_code}\n" http://127.0.0.1/ || true
echo "  服务器公网 IP: 47.119.35.129"
echo "===== 部署完成 ====="
echo "用浏览器访问: http://47.119.35.129"
echo ""
echo "若打不开，多半是阿里云安全组没放行 80 端口："
echo "  控制台 → 云服务器 ECS → 实例 → 安全组 → 配置规则 → 入方向 → 允许 TCP 80"
echo ""
echo "常用运维："
echo "  查看日志   : journalctl -u chat -f"
echo "  重启服务   : systemctl restart chat"
echo "  停止服务   : systemctl stop chat"
echo "  改端口     : 编辑 /etc/systemd/system/chat.service 里的 Environment=PORT=xx 后 systemctl daemon-reload && systemctl restart chat"
