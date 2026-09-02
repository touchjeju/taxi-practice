# 택시 연습하기 - 사이트에 올리기
# menu/ 와 app/ 의 내용을 docs/ 로 복사한 뒤 GitHub 에 올린다.
# 45초쯤 뒤에 https://touchjeju.github.io/taxi-practice/ 에 반영된다.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# git 은 새 창에서 PATH 에 안 잡힐 때가 있어 직접 넣어 준다
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

Write-Host ''
Write-Host '=====  택시 연습하기 올리기  =====' -ForegroundColor Cyan
Write-Host ''

# 1. 원본을 docs 폴더로 복사
New-Item -ItemType Directory -Force -Path 'docs\img', 'docs\app\img' | Out-Null
Copy-Item 'menu\index.html' 'docs\index.html' -Force
Copy-Item 'menu\img\*' 'docs\img\' -Force -Recurse
Copy-Item 'app\index.html', 'app\style.css', 'app\app.js' 'docs\app\' -Force
Copy-Item 'app\img\*' 'docs\app\img\' -Force -Recurse
# style.css / app.js 뒤에 버전 표시를 붙인다.
# 이게 없으면 폰이 새 index.html 과 옛 app.js 를 섞어 받아서 앱이 통째로 죽는다.
$ver = Get-Date -Format 'yyyyMMddHHmm'
$p = 'docs\app\index.html'
$t = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
$t = $t -replace 'href="style\.css(\?v=\d+)?"', ('href="style.css?v=' + $ver + '"')
$t = $t -replace 'src="app\.js(\?v=\d+)?"', ('src="app.js?v=' + $ver + '"')
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Host ('[1/3] 메뉴와 앱을 docs 폴더로 복사했습니다. (버전 ' + $ver + ')') -ForegroundColor Green

# 옛 스크린샷 튜토리얼은 standalone 파일이 새로 빌드돼 있을 때만 따라 올라간다
if (Test-Path '택시연습하기-standalone.html') {
    $new = (Get-FileHash '택시연습하기-standalone.html' -Algorithm MD5).Hash
    $old = if (Test-Path 'docs\guide\index.html') {
        (Get-FileHash 'docs\guide\index.html' -Algorithm MD5).Hash
    } else { '' }
    if ($new -ne $old) {
        New-Item -ItemType Directory -Force -Path 'docs\guide' | Out-Null
        Copy-Item '택시연습하기-standalone.html' 'docs\guide\index.html' -Force
        Write-Host '      옛 튜토리얼(guide)도 함께 올립니다.' -ForegroundColor DarkGray
    }
}

# 2. 바뀐 게 있는지 확인
git add docs | Out-Null
$changed = git status --porcelain docs
if (-not $changed) {
    Write-Host ''
    Write-Host '바뀐 내용이 없습니다. 사이트는 이미 최신입니다.' -ForegroundColor Yellow
    Write-Host ''
    return
}
$count = ($changed -split "`n" | Where-Object { $_ }).Count
Write-Host "[2/3] 바뀐 파일 $count 개를 찾았습니다." -ForegroundColor Green
$changed | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }

# 3. 커밋하고 GitHub 에 올리기
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
git commit -q -m "Update practice app ($stamp)"
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '커밋에 실패했습니다. 위 메시지를 확인해 주세요.' -ForegroundColor Red
    Write-Host ''
    return
}
git push -q origin master
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '올리기에 실패했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요.' -ForegroundColor Red
    Write-Host ''
    return
}

Write-Host '[3/3] GitHub 에 올렸습니다.' -ForegroundColor Green
Write-Host ''
Write-Host '45초쯤 뒤에 아래 주소에 반영됩니다. 폰의 앱도 함께 바뀝니다.' -ForegroundColor Cyan
Write-Host '  https://touchjeju.github.io/taxi-practice/' -ForegroundColor White
Write-Host ''
