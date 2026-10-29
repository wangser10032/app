# 一键操作 ResiHub 开发容器（Windows / PowerShell 7）
#
#   .\deploy\dev.ps1 up        # 启动（首次自动构建镜像）
#   .\deploy\dev.ps1 shell     # 进入容器
#   .\deploy\dev.ps1 logs      # 查看容器日志
#   .\deploy\dev.ps1 down      # 停止并删除容器
param(
    [ValidateSet('up', 'down', 'shell', 'logs', 'ps', 'build', 'restart', 'destroy', 'doctor')]
    [string]$Action = 'up'
)

$ErrorActionPreference = 'Stop'

# Docker Desktop 的 CLI 目录不一定在当前 shell 的 PATH 中
$dockerBin = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'
if (Test-Path (Join-Path $dockerBin 'docker.exe')) {
    if (($env:PATH -split ';') -notcontains $dockerBin) { $env:PATH = "$env:PATH;$dockerBin" }
}

$composeFile = Join-Path $PSScriptRoot 'docker-compose.dev.yml'

function Assert-Daemon {
    & docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker 守护进程未运行，请先启动 Docker Desktop。'
    }
}

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    # 注意：不要加 --project-directory，否则 compose 会把 context: .. 解析到仓库之外
    & docker compose -f $composeFile @ComposeArgs
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') 失败（exit $LASTEXITCODE）" }
}

switch ($Action) {
    'up' {
        Assert-Daemon
        # 首次运行或镜像不存在时构建
        & docker image inspect resihub-dev:node20 *> $null
        if ($LASTEXITCODE -ne 0) { Invoke-Compose @('build') }
        Invoke-Compose @('up', '-d')
        & docker compose -f $composeFile ps
    }
    'build' {
        Assert-Daemon
        Invoke-Compose @('build')
    }
    'shell' {
        Assert-Daemon
        & docker compose -f $composeFile exec dev bash
    }
    'logs' {
        & docker compose -f $composeFile logs -f --tail 100
    }
    'ps' {
        & docker compose -f $composeFile ps
    }
    'restart' {
        Invoke-Compose @('restart')
    }
    'down' {
        Invoke-Compose @('down')
    }
    'destroy' {
        # 连同 node_modules 命名卷一起删除（代码目录不受影响）
        Invoke-Compose @('down', '-v')
    }
    'doctor' {
        Assert-Daemon
        Write-Host "docker  : $(docker --version)"
        Write-Host "compose : $(docker compose version --short)"
        Write-Host "vm      : $(docker info --format '{{.OperatingSystem}} / {{.OSType}} / {{.ServerVersion}}')"
        & docker compose -f $composeFile ps
    }
}
