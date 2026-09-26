# ============================================================
# 確認用の簡易 Web サーバー（開発用。公開には使わない）
#   この開発機には Python / Node がないため、PowerShell だけで動くサーバーを用意している。
#   使い方（PowerShell）：
#     powershell -NoProfile -ExecutionPolicy Bypass -File DRAINDIVE/tools/serve.ps1
#     → http://localhost:8000/（ドット絵版） / http://localhost:8000/3d.html（3D版）
#   -Root で配信するフォルダ、-Port でポート番号を変えられる（省略時は DRAINDIVE フォルダ・8000番）
#   キャッシュを無効にしているので、ファイルを直したら再読み込みするだけで反映される
# ============================================================
param(
  [string]$Root = "",
  [int]$Port = 8000
)

# 省略時は、このスクリプト（tools/）の1つ上＝ DRAINDIVE フォルダを配信する
# （Windows PowerShell 5.1 では param の既定値の中で $PSScriptRoot が空になるため、ここで決める）
if (-not $Root) {
  $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $rootFull on http://localhost:$Port/"

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
}

while ($listener.IsListening) {
  $c = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  # フォルダを指したときは index.html を返す
  if ($path -eq "" -or $path.EndsWith("/")) { $path = $path + "index.html" }
  $file = [IO.Path]::GetFullPath((Join-Path $rootFull $path))

  # 配信フォルダの外のファイルは返さない
  if ($file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    if ($types.ContainsKey($ext)) { $c.Response.ContentType = $types[$ext] }
    $c.Response.Headers.Add("Cache-Control", "no-store")
    $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $c.Response.StatusCode = 404
  }
  $c.Response.Close()
  Write-Host "$($c.Request.HttpMethod) /$path"
}
