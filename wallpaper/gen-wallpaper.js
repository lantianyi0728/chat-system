'use strict';
// 生成「命令速查壁纸」HTML，再用无头浏览器截图成 1920x1080 PNG
const fs = require('fs');
const path = require('path');

// 每张卡片 = 一类命令，纵向为「命令 | 说明」两列表格
const tables = [
  {
    title: 'Linux · 文件与目录',
    rows: [
      ['pwd', '显示当前所在目录'],
      ['ls -la', '列出全部文件(含隐藏)及详情'],
      ['cd ~', '回到用户主目录'],
      ['cd ..', '返回上一级目录'],
      ['cd /path', '切换到指定目录'],
      ['mkdir dir', '新建文件夹'],
      ['touch a.txt', '新建空文件'],
      ['cp 源 目标', '复制文件或目录'],
      ['mv 旧 新', '移动或重命名'],
      ['rm 文件', '删除文件'],
      ['rm -rf dir', '强制删除文件夹'],
      ['cat 文件', '查看文件全部内容'],
      ['less 文件', '分页查看(空格翻页)'],
      ['head -n 5 f', '查看文件前 5 行'],
      ['tail -f 文件', '实时追踪文件末尾'],
      ['ln -s 源 链接', '创建软链接'],
    ],
  },
  {
    title: 'Linux · 系统 / 进程 / 网络',
    rows: [
      ['ps aux', '查看所有进程'],
      ['top', '实时监控资源占用'],
      ['kill 1234', '结束指定 PID 进程'],
      ['kill -9 1234', '强制结束进程'],
      ['df -h', '查看磁盘剩余空间'],
      ['du -sh dir', '统计目录占用大小'],
      ['free -m', '查看内存使用情况'],
      ['uname -a', '查看内核与系统信息'],
      ['ifconfig', '查看网卡 IP 地址'],
      ['ping 主机', '测试网络连通性'],
      ['wget 网址', '下载网络文件'],
      ['curl -O 网址', '下载并显示进度'],
      ['netstat -tunlp', '查看监听端口'],
      ['chmod 755 文件', '修改文件权限'],
      ['sudo 命令', '以管理员身份执行'],
      ['uptime', '查看运行时长与负载'],
    ],
  },
  {
    title: 'CMD · Windows 常用',
    rows: [
      ['echo %cd%', '显示当前目录'],
      ['cd', '切换目录'],
      ['cd ..', '返回上一级'],
      ['dir', '列出当前目录文件'],
      ['md 名字', '新建文件夹'],
      ['type nul > a.txt', '新建空文件'],
      ['copy 源 目标', '复制文件'],
      ['move 旧 新', '移动 / 重命名'],
      ['del 文件', '删除文件'],
      ['rmdir /s dir', '删除文件夹'],
      ['type 文件', '查看文本文件内容'],
      ['cls', '清屏'],
      ['systeminfo', '查看系统信息'],
      ['shutdown /s', '关机'],
      ['shutdown /r', '重启'],
      ['where 名字', '查找命令路径'],
    ],
  },
  {
    title: 'CMD · 进程 / 网络 / 磁盘',
    rows: [
      ['tasklist', '查看运行中的进程'],
      ['taskkill /pid 1234', '结束指定进程'],
      ['taskmgr', '打开任务管理器'],
      ['ipconfig', '查看网络配置'],
      ['ipconfig /flushdns', '刷新 DNS 缓存'],
      ['ping 主机', '测试网络连通'],
      ['tracert 主机', '追踪路由路径'],
      ['netstat -an', '查看所有连接'],
      ['chkdsk', '检查磁盘错误'],
      ['wmic logicaldisk', '查看磁盘空间'],
      ['sfc /scannow', '修复系统文件'],
      ['compact /c dir', '压缩目录'],
      ['powershell', '启动 PowerShell'],
      ['help', '查看命令帮助'],
      ['ver', '查看系统版本'],
      ['assoc', '查看文件类型关联'],
    ],
  },
  {
    title: 'Git · 版本控制',
    rows: [
      ['git init', '初始化仓库'],
      ['git clone 网址', '克隆远程仓库'],
      ['git add .', '暂存所有改动'],
      ['git commit -m "x"', '提交到本地'],
      ['git status', '查看当前状态'],
      ['git diff', '查看具体改动'],
      ['git log --oneline', '查看提交历史'],
      ['git branch', '查看分支列表'],
      ['git checkout -b x', '新建并切换分支'],
      ['git merge x', '合并指定分支'],
      ['git pull', '拉取并合并更新'],
      ['git push', '推送到远程'],
      ['git remote -v', '查看远程地址'],
      ['git reset --hard', '回退到上一版本'],
      ['git stash', '暂存未提交改动'],
      ['git clone -b x 网址', '克隆指定分支'],
    ],
  },
  {
    title: '快捷键 · 通用',
    rows: [
      ['Ctrl + C', '复制选中内容'],
      ['Ctrl + V', '粘贴'],
      ['Ctrl + X', '剪切'],
      ['Ctrl + Z', '撤销'],
      ['Ctrl + A', '全选'],
      ['Ctrl + S', '保存文件'],
      ['Ctrl + F', '查找内容'],
      ['Tab', '命令自动补全'],
      ['↑ / ↓', '浏览历史命令'],
      ['Alt + Tab', '切换窗口'],
      ['Win + D', '显示桌面'],
      ['Win + E', '打开文件管理器'],
      ['Win + R', '打开运行窗口'],
      ['Ctrl + L', '终端清屏(Linux)'],
      ['Ctrl + R', '搜索历史命令'],
      ['Win + L', '锁定计算机'],
    ],
  },
];

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const cardsHtml = tables.map((t) => {
  const rowsHtml = t.rows.map((r) => `
      <tr>
        <td class="cmd">${esc(r[0])}</td>
        <td class="desc">${esc(r[1])}</td>
      </tr>`).join('');
  return `
    <div class="card">
      <div class="card-title">${esc(t.title)}</div>
      <table>
        <tbody>${rowsHtml}
        </tbody>
      </table>
    </div>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>命令速查壁纸</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1920px; height:1080px; overflow:hidden; }
  body {
    font-family: "PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    background:#000000; color:#ffffff;
    padding:14px 24px 12px;
    display:flex; flex-direction:column;
  }
  .title { text-align:center; margin-bottom:8px; }
  .title h1 { font-size:25px; font-weight:800; letter-spacing:5px; color:#ffffff; }
  .title p { color:#8a97ab; font-size:12px; margin-top:3px; letter-spacing:1px; }

  .grid {
    flex:1; min-height:0;
    display:grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: 1fr;
    gap:12px;
  }
  .card {
    border:1px solid #2a2f3a; border-radius:8px; overflow:hidden;
    display:flex; flex-direction:column; min-height:0; background:#050505;
  }
  .card-title {
    text-align:center; font-size:13.5px; font-weight:700; padding:5px;
    color:#ffffff; background:#0c0c0c; border-bottom:1px solid #2a2f3a; letter-spacing:1px;
  }
  table { width:100%; border-collapse:collapse; flex:1; table-layout:fixed; }
  td { border-bottom:1px solid #1c1f26; padding:3px 9px; vertical-align:middle; }
  td.cmd {
    color:#ffffff; font-family: Consolas,"Courier New",monospace;
    font-size:12.5px; font-weight:700; line-height:1.2;
    border-right:1px solid #2a2f3a; width:55%;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  td.desc { color:#4ade80; font-size:10.5px; line-height:1.2; }
  .footer { text-align:center; color:#7a8aa0; font-size:11px; margin-top:6px; letter-spacing:1px; }
</style>
</head>
<body>
  <div class="title">
    <h1>命令速查壁纸</h1>
    <p>Linux · Windows CMD · Git · 快捷键　|　白字为命令，绿字为说明</p>
  </div>

  <div class="grid">
    ${cardsHtml}
  </div>

  <div class="footer">提示：Linux 区分大小写；CMD 参数常用 /（如 shutdown /s）；Git 命令需在仓库目录内使用</div>
</body>
</html>`;

const outHtml = path.join(__dirname, 'cmd-linux-wallpaper.html');
fs.writeFileSync(outHtml, html, 'utf8');
console.log('已生成:', outHtml, '| 共', tables.length, '张表，',
  tables.reduce((s, t) => s + t.rows.length, 0), '条命令');
