#!/usr/bin/env bash
# Linux installer. Read configuration as data; never source an application .env.
set -Eeuo pipefail
umask 077

INSTALL_DIR=/opt/oil-spread-monitor
SOURCE_REPOSITORY=https://github.com/hxx344/oil-spread-monitor.git
NON_INTERACTIVE=0
SKIP_DOCKER_INSTALL=0
PORT_OPTION=''
BIND_OPTION=''
DOMAIN_OPTION=''
TEMP_FILES=()
NEW_TOKEN=0
INTERACTIVE=0

log() { printf '\n[oil-monitor] %s\n' "$*"; }
die() { printf '\n[oil-monitor] 错误：%s\n' "$*" >&2; exit 1; }
cleanup() { local item; for item in "${TEMP_FILES[@]}"; do rm -f -- "$item"; done; }
trap cleanup EXIT
trap 'printf "\n[oil-monitor] 安装未完成（第 %s 行）。修复错误后可重新执行，配置和数据卷不会被删除。\n" "$LINENO" >&2' ERR

usage() {
  cat <<'USAGE'
用法：sudo bash deploy/install.sh [选项]
  --dir PATH              安装目录，默认 /opt/oil-spread-monitor
  --port PORT             首次安装的 HTTP 端口，默认 3000
  --bind ADDRESS          首次安装的绑定地址，默认无域名 0.0.0.0、有域名 127.0.0.1
  --domain DOMAIN         首次安装启用此域名的自动 HTTPS（需要 DNS 和 80/443 端口）
  --non-interactive       不提问；可从环境变量读取飞书配置，否则留空
  --skip-docker-install   只使用已安装的 Docker 和 Compose
  --source PATH           从本地 Git 仓库部署已提交的代码，默认使用 GitHub main
  --help                  显示帮助

首次安装可通过环境变量 ADMIN_TOKEN、FEISHU_WEBHOOK_URL、FEISHU_WEBHOOK_SECRET、
OIL_DOMAIN、HTTP_PORT、BIND_ADDRESS 提供配置。重复执行保留已有 .env 和数据卷。
USAGE
}

parse_options() {
while (($#)); do
  case "$1" in
    --dir|--port|--bind|--domain|--source)
      (($# >= 2)) || die "$1 缺少参数"
      case "$1" in
        --dir) INSTALL_DIR=$2;; --port) PORT_OPTION=$2;; --bind) BIND_OPTION=$2;;
        --domain) DOMAIN_OPTION=$2;; --source) SOURCE_REPOSITORY=$2;;
      esac
      shift 2;;
    --non-interactive) NON_INTERACTIVE=1; shift;;
    --skip-docker-install) SKIP_DOCKER_INSTALL=1; shift;;
    --help|-h) usage; exit 0;;
    *) die "未知选项：$1";;
  esac
done
}

prepare_platform() {
[[ $(uname -s) == Linux ]] || die '一键部署仅支持 Linux'
((EUID == 0)) || die '请使用 sudo bash 运行安装脚本，或使用 root 账号'
case "$(uname -m)" in x86_64|aarch64) ;; *) die '自动部署支持 x86_64 和 aarch64 架构';; esac
[[ $INSTALL_DIR == /* && $INSTALL_DIR != *$'\n'* && ! -L $INSTALL_DIR ]] || die '安装目录必须是绝对路径且不能是符号链接'
INSTALL_DIR=$(realpath -m -- "$INSTALL_DIR")
case "$INSTALL_DIR" in /|/etc|/usr|/var|/opt|/home|/root|/tmp) die '请选择独立的应用子目录';; esac

INTERACTIVE=0
if ((NON_INTERACTIVE == 0)) && [[ -t 1 ]] && { exec 3<>/dev/tty; } 2>/dev/null; then INTERACTIVE=1; fi
}
ask() {
  local name=$1 prompt=$2 hidden=${3:-0} answer=''
  ((INTERACTIVE)) || return 0
  printf '%s' "$prompt" >&3
  if ((hidden)); then read -rs -u 3 answer || true; printf '\n' >&3; else read -r -u 3 answer || true; fi
  printf -v "$name" '%s' "$answer"
}

apt_platform() {
  local ID='' VERSION_CODENAME='' UBUNTU_CODENAME=''
  # /etc/os-release is trusted operating-system metadata, not project input.
  . /etc/os-release
  OIL_DISTRO=$ID
  OIL_SUITE=${UBUNTU_CODENAME:-$VERSION_CODENAME}
  case "$OIL_DISTRO:$OIL_SUITE" in
    ubuntu:jammy|ubuntu:noble|ubuntu:resolute|debian:bookworm|debian:trixie) ;;
    *) die '自动安装依赖支持 Ubuntu 22.04/24.04/26.04、Debian 12/13；其他 Linux 请先安装 Docker Compose、git、curl、flock';;
  esac
}

bootstrap() {
  local missing=0 tool
  for tool in git curl flock; do command -v "$tool" >/dev/null 2>&1 || missing=1; done
  if ((missing)); then
    apt_platform
    log '安装 git、curl 和进程锁工具'
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install --no-remove -y ca-certificates curl git util-linux
  fi
}

docker_local() { docker --context default "$@"; }

docker_repository() {
  apt_platform
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install --no-remove -y ca-certificates curl
  # Reuse an existing Docker source, including its Signed-By setting.
  if grep -Rqs -- "https://download.docker.com/linux/$OIL_DISTRO" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then return; fi
  local key_temp
  install -m 0755 -d /etc/apt/keyrings
  key_temp=$(mktemp /etc/apt/keyrings/oil-docker.XXXXXX)
  TEMP_FILES+=("$key_temp")
  curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "https://download.docker.com/linux/$OIL_DISTRO/gpg" -o "$key_temp"
  grep -q 'BEGIN PGP PUBLIC KEY BLOCK' "$key_temp" || die 'Docker 公钥下载无效'
  install -m 0644 "$key_temp" /etc/apt/keyrings/oil-monitor-docker.asc
  cat > /etc/apt/sources.list.d/oil-monitor-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$OIL_DISTRO
Suites: $OIL_SUITE
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/oil-monitor-docker.asc
EOF
  chmod 0644 /etc/apt/sources.list.d/oil-monitor-docker.sources
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    ((SKIP_DOCKER_INSTALL == 0)) || die '未找到 Docker，且已指定跳过安装'
    apt_platform
    local package conflicts=''
    for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
      if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true) == installed ]]; then conflicts+=" $package"; fi
    done
    [[ -z $conflicts ]] || die "检测到现有容器组件：$conflicts。请先完成 Docker 迁移；脚本不会卸载它们。"
    log '从 Docker 官方软件源安装 Engine 与 Compose'
    docker_repository
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install --no-remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif ! docker_local compose version >/dev/null 2>&1; then
    ((SKIP_DOCKER_INSTALL == 0)) || die '未找到 docker compose 插件'
    log '保留已有 Docker，安装 Compose 插件'
    docker_repository
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install --no-remove -y docker-compose-plugin
  fi
  docker_local compose version >/dev/null || die 'Docker Compose 插件不可用'
  if ! docker_local info >/dev/null 2>&1; then
    if command -v systemctl >/dev/null 2>&1; then systemctl enable --now docker;
    elif command -v service >/dev/null 2>&1; then service docker start;
    else die 'Docker daemon 未运行，请启动 Docker 后重试'; fi
  fi
  docker_local info >/dev/null 2>&1 || die '无法连接本机 Docker daemon'
}

repo_git() { git -c safe.directory="$INSTALL_DIR" -c safe.directory="$SOURCE_REPOSITORY" -c core.hooksPath=/dev/null -C "$INSTALL_DIR" "$@"; }
install_source() {
  if [[ $SOURCE_REPOSITORY != https://github.com/hxx344/oil-spread-monitor.git ]]; then
    [[ -d $SOURCE_REPOSITORY ]] || die '--source 需要本地 Git 仓库目录'
    SOURCE_REPOSITORY=$(realpath -- "$SOURCE_REPOSITORY")
    git -c safe.directory="$SOURCE_REPOSITORY" -C "$SOURCE_REPOSITORY" rev-parse --verify HEAD >/dev/null || die '本地源码尚无提交'
  fi
  if [[ -d $INSTALL_DIR/.git ]]; then
    local actual branch
    actual=$(repo_git remote get-url origin)
    [[ $actual == "$SOURCE_REPOSITORY" || $actual == "${SOURCE_REPOSITORY%.git}" ]] || die '安装目录属于其他仓库，未修改该目录'
    [[ $(repo_git rev-parse --show-toplevel) == "$INSTALL_DIR" ]] || die '安装目录不是独立仓库根目录'
    if ! repo_git diff --quiet || ! repo_git diff --cached --quiet; then die '源码有未提交修改，请先保存；安装器不会覆盖修改'; fi
    branch=$(repo_git symbolic-ref --short HEAD) || die '安装目录处于 detached HEAD，请先切回 main'
    [[ $branch == main ]] || die '安装目录不在 main 分支，请先切回 main'
    log '获取最新代码，保留现有配置和数据'
    repo_git fetch origin main
    repo_git merge-base --is-ancestor HEAD origin/main || die '本地存在分叉或额外提交，未覆盖本地代码'
    repo_git merge --ff-only origin/main
  else
    [[ ! -e $INSTALL_DIR || -z $(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit) ]] || die '安装目录非空且不是本项目仓库，未修改该目录'
    install -d -m 0755 "$INSTALL_DIR"
    log '下载应用代码'
    git -c safe.directory="$SOURCE_REPOSITORY" -c core.hooksPath=/dev/null clone --branch main --single-branch "$SOURCE_REPOSITORY" "$INSTALL_DIR"
  fi
}

read_setting() {
  awk -v key="$1" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      v=substr($0,index($0,"=")+1); sub(/\r$/, "", v); gsub(/^[[:space:]]+|[[:space:]]+$/, "", v);
      q=substr(v,1,1);
      if (q==sprintf("%c",39) || q=="\"") {
        escaped=0;
        for (i=2;i<=length(v);i++) {
          c=substr(v,i,1);
          if (c==q && !escaped) { v=substr(v,2,i-2); break; }
          if (c=="\\" && !escaped) escaped=1; else escaped=0;
        }
      } else sub(/[[:space:]]+#.*$/, "", v);
      result=v;
    } END { print result }' "$INSTALL_DIR/.env"
}
env_line() {
  [[ $2 != *$'\n'* && $2 != *$'\r'* && $2 != *"'"* ]] || die '配置值不能包含换行或单引号'
  printf "%s='%s'\n" "$1" "$2"
}
random_token() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
validate_access() {
  APP_DOMAIN=${APP_DOMAIN,,}
  [[ $APP_PORT =~ ^[0-9]{1,5}$ ]] || die 'HTTP 端口需要 1–65535 的整数'
  ((10#$APP_PORT >= 1 && 10#$APP_PORT <= 65535)) || die 'HTTP 端口需要 1–65535 的整数'
  APP_PORT=$((10#$APP_PORT))
  [[ $APP_BIND == 0.0.0.0 || $APP_BIND == 127.0.0.1 ]] || die '绑定地址请使用 0.0.0.0 或 127.0.0.1'
  if [[ -n $APP_DOMAIN ]]; then
    [[ ${#APP_DOMAIN} -le 253 && $APP_DOMAIN =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]] || die '域名格式无效，请只填写 example.com，不带 https:// 或路径'
    [[ $APP_PORT != 80 && $APP_PORT != 443 ]] || die '启用 HTTPS 时请将应用端口设为 3000 等非 80/443 端口'
  fi
}
configure() {
  [[ ! -L $INSTALL_DIR/.env ]] || die '.env 不能是符号链接'
  local admin_token=${ADMIN_TOKEN:-} webhook=${FEISHU_WEBHOOK_URL:-} secret=${FEISHU_WEBHOOK_SECRET:-} temp
  if [[ -n $PORT_OPTION ]]; then
    [[ $PORT_OPTION =~ ^[0-9]{1,5}$ ]] || die 'HTTP 端口需要 1–65535 的整数'
    ((10#$PORT_OPTION >= 1 && 10#$PORT_OPTION <= 65535)) || die 'HTTP 端口需要 1–65535 的整数'
    PORT_OPTION=$((10#$PORT_OPTION))
  fi
  if [[ ! -e $INSTALL_DIR/.env ]]; then
    APP_DOMAIN=${DOMAIN_OPTION:-${OIL_DOMAIN:-}}
    if [[ -z $APP_DOMAIN ]]; then ask APP_DOMAIN '访问域名（留空使用 IP:3000）：'; fi
    APP_PORT=${PORT_OPTION:-${HTTP_PORT:-3000}}
    APP_BIND=${BIND_OPTION:-${BIND_ADDRESS:-}}
    if [[ -z $APP_BIND ]]; then if [[ -n $APP_DOMAIN ]]; then APP_BIND=127.0.0.1; else APP_BIND=0.0.0.0; fi; fi
    validate_access
    if [[ -z $webhook ]]; then ask webhook '飞书 Webhook（隐藏输入，留空稍后配置）：' 1; fi
    if [[ -n $webhook && -z $secret ]]; then ask secret '飞书签名密钥（隐藏输入，可留空）：' 1; fi
    [[ -z $webhook || $webhook =~ ^https://(open\.feishu\.cn|open\.larksuite\.com)/open-apis/bot/v2/hook/[a-zA-Z0-9-]+$ ]] || die '飞书 Webhook 地址格式无效'
    if [[ -z $admin_token ]]; then admin_token=$(random_token); NEW_TOKEN=1; fi
    ((${#admin_token} >= 24)) || die 'ADMIN_TOKEN 至少需要 24 个字符'
    temp=$(mktemp "$INSTALL_DIR/.env.install.XXXXXX"); TEMP_FILES+=("$temp")
    {
      env_line ADMIN_TOKEN "$admin_token"
      env_line FEISHU_WEBHOOK_URL "$webhook"
      env_line FEISHU_WEBHOOK_SECRET "$secret"
      env_line POLL_INTERVAL_SECONDS 30
      env_line PORT 3000
      env_line HOST 0.0.0.0
      env_line DATA_DIR ./data
      env_line OIL_DOMAIN "$APP_DOMAIN"
      env_line PUBLIC_ORIGIN "${APP_DOMAIN:+https://$APP_DOMAIN}"
      env_line BIND_ADDRESS "$APP_BIND"
      env_line HTTP_PORT "$APP_PORT"
      env_line COMPOSE_PROJECT_NAME "${COMPOSE_PROJECT_NAME:-$(basename "$INSTALL_DIR" | tr '[:upper:]' '[:lower:]')}"
    } > "$temp"
    mv -- "$temp" "$INSTALL_DIR/.env"
  else
    log '保留已有 .env 配置'
    APP_DOMAIN=$(read_setting OIL_DOMAIN)
    APP_PORT=$(read_setting HTTP_PORT); APP_PORT=${APP_PORT:-3000}
    APP_BIND=$(read_setting BIND_ADDRESS); APP_BIND=${APP_BIND:-127.0.0.1}
    validate_access
    [[ -z $DOMAIN_OPTION || ${DOMAIN_OPTION,,} == "${APP_DOMAIN,,}" ]] || die '已有域名配置与参数不一致，请直接修改 .env 后重新执行'
    [[ -z $PORT_OPTION || $PORT_OPTION == "$APP_PORT" ]] || die '已有端口配置与参数不一致，请直接修改 .env 后重新执行'
    [[ -z $BIND_OPTION || $BIND_OPTION == "$APP_BIND" ]] || die '已有绑定地址与参数不一致，请直接修改 .env 后重新执行'
    admin_token=$(read_setting ADMIN_TOKEN)
    if [[ -z $admin_token ]]; then
      admin_token=$(random_token); NEW_TOKEN=1
      temp=$(mktemp "$INSTALL_DIR/.env.install.XXXXXX"); TEMP_FILES+=("$temp")
      awk '!/^[[:space:]]*ADMIN_TOKEN[[:space:]]*=/' "$INSTALL_DIR/.env" > "$temp"
      env_line ADMIN_TOKEN "$admin_token" >> "$temp"
      mv -- "$temp" "$INSTALL_DIR/.env"
    fi
    ((${#admin_token} >= 24)) || die '已有 ADMIN_TOKEN 少于 24 个字符，请修改 .env'
  fi
  chmod 0600 "$INSTALL_DIR/.env"
  APP_PROJECT=$(read_setting COMPOSE_PROJECT_NAME)
  APP_PROJECT=${APP_PROJECT:-$(basename "$INSTALL_DIR" | tr '[:upper:]' '[:lower:]')}
  [[ $APP_PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'Compose 项目名需要小写字母、数字、下划线或连字符，且以字母或数字开头'
  # Credentials appear only on the interactive terminal, never in unattended logs.
  if ((NEW_TOKEN && INTERACTIVE)); then printf '\n生成的管理口令：%s\n请保存此口令，前端解锁设置时使用。\n' "$admin_token" >&3; fi
  unset admin_token webhook secret
}

deploy() {
  local -a compose_args=(--project-name "$APP_PROJECT" --project-directory "$INSTALL_DIR" --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yaml")
  if [[ -n $APP_DOMAIN ]]; then compose_args+=(-f "$INSTALL_DIR/compose.https.yaml"); fi
  # Shell variables otherwise override --env-file interpolation in Compose.
  export HTTP_PORT=$APP_PORT BIND_ADDRESS=$APP_BIND OIL_DOMAIN=$APP_DOMAIN
  log '构建并启动监控服务'
  docker_local compose "${compose_args[@]}" config --quiet
  docker_local compose "${compose_args[@]}" up -d --build --remove-orphans
  local _attempt container healthy=0
  container=$(docker_local compose "${compose_args[@]}" ps -q oil-monitor)
  [[ -n $container ]] || die '监控容器未启动，请检查 Docker Compose 输出'
  for _attempt in {1..60}; do
    if timeout 8 docker --context default exec "$container" node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok||!(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 2
  done
  ((healthy)) || die "服务未通过启动检查。查看日志：cd '$INSTALL_DIR' && sudo docker compose logs --tail=80"
  log '监控应用已通过健康检查'
  if [[ -n $APP_DOMAIN ]]; then
    local proxy https_ready=0 response
    proxy=$(docker_local compose "${compose_args[@]}" ps -q caddy)
    if [[ -z $proxy ]] || ! docker_local exec "$proxy" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then die 'HTTPS 代理启动失败，请检查 Caddy 日志'; fi
    log '等待 HTTPS 证书和域名访问就绪'
    for _attempt in {1..12}; do
      response=$(curl --fail --silent --show-error --connect-timeout 3 --max-time 5 "https://$APP_DOMAIN/api/health" 2>/dev/null || true)
      if [[ $response == *'"service":"oil-spread-monitor"'* && $response == *'"ok":true'* ]]; then https_ready=1; break; fi
      sleep 5
    done
    ((https_ready)) || die "应用已启动，但 HTTPS 尚未就绪。请确认 $APP_DOMAIN 指向本机并放行 80/443 端口，再重复执行；配置和数据已保留。"
    printf '访问地址：https://%s\n' "$APP_DOMAIN"
  elif [[ $APP_BIND == 127.0.0.1 ]]; then
    printf '本机地址：http://127.0.0.1:%s\n远程访问可使用 SSH 转发或本机反向代理。\n' "$APP_PORT"
  else
    printf '访问地址：http://服务器IP:%s\n' "$APP_PORT"
  fi
  printf '配置文件：%s/.env（ADMIN_TOKEN 为管理口令）\n' "$INSTALL_DIR"
  printf '前端打开“告警设置”→ 解锁 → 设置梯度 → 启用并保存。\n'
  printf '再次执行同一安装命令可升级，保留配置和数据卷。\n'
  log '部署完成'
}

main() {
parse_options "$@"
prepare_platform
bootstrap
[[ ! -L /run/oil-spread-monitor && ! -L /run/oil-spread-monitor/install.lock ]] || die '部署锁路径不能是符号链接'
install -d -o 0 -g 0 -m 0700 /run/oil-spread-monitor
exec 9>/run/oil-spread-monitor/install.lock
flock --nonblock 9 || die '另一个部署正在进行，请等待其完成'
ensure_docker
install_source
configure
deploy
}

if [[ -z ${BASH_SOURCE[0]:-} || ${BASH_SOURCE[0]:-} == "$0" ]]; then main "$@"; fi
