<#
.SYNOPSIS
  Minimal static file server for the Pay360 QM dashboard (DAX HTML replica).

.DESCRIPTION
  Serves ./public on http://localhost:<Port>/ only (not exposed to the network).
  GET/HEAD only, extension allowlist, path-traversal protection, strict security headers.
  No authentication: intended for local viewing only. Do not expose this port externally.

.EXAMPLE
  .\server.ps1            # http://localhost:8081
  .\server.ps1 -Port 8082 -NoBrowser
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8081,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sep  = [System.IO.Path]::DirectorySeparatorChar
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'public')).TrimEnd($sep)
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    Write-Error "Web root not found: $root"
    exit 1
}

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.csv'  = 'text/csv; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
}

$securityHeaders = [ordered]@{
    'Content-Security-Policy' = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    'X-Content-Type-Options'  = 'nosniff'
    'X-Frame-Options'         = 'DENY'
    'Referrer-Policy'         = 'no-referrer'
    'Cache-Control'           = 'no-store'
    'Cross-Origin-Opener-Policy' = 'same-origin'
}

function Send-Response {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$Status,
        [string]$ContentType,
        [byte[]]$Body,
        [bool]$HeadOnly
    )
    $Response.StatusCode = $Status
    foreach ($key in $securityHeaders.Keys) { $Response.AddHeader($key, $securityHeaders[$key]) }
    $Response.ContentType = $ContentType
    $Response.ContentLength64 = $Body.Length
    if (-not $HeadOnly -and $Body.Length -gt 0) {
        $Response.OutputStream.Write($Body, 0, $Body.Length)
    }
}

function Send-Text {
    param([System.Net.HttpListenerResponse]$Response, [int]$Status, [string]$Message, [bool]$HeadOnly)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
    Send-Response -Response $Response -Status $Status -ContentType 'text/plain; charset=utf-8' -Body $bytes -HeadOnly $HeadOnly
}

function Resolve-RequestPath {
    # Returns a validated absolute file path inside $root, or $null.
    param([string]$AbsolutePath)

    $path = [System.Uri]::UnescapeDataString($AbsolutePath)
    # Reject control chars, traversal, backslashes, drive/ADS colons.
    if ($path -match '[\x00-\x1F\x7F]' -or $path.Contains('..') -or $path.Contains('\') -or $path.Contains(':')) {
        return $null
    }
    if ($path.EndsWith('/')) { $path += 'index.html' }

    $relative = $path.TrimStart('/').Replace('/', [string]$sep)
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $full.StartsWith($root + $sep, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    return $full
}

function Write-AccessLog {
    param([string]$Method, [string]$Path, [int]$Status)
    $safePath = $Path -replace '[^\w\-./%]', '?'   # never echo raw control chars to the console
    Write-Host ("{0}  {1,-4} {2,3}  {3}" -f (Get-Date -Format 'HH:mm:ss'), $Method, $Status, $safePath)
}

function Invoke-Request {
    param([System.Net.HttpListenerContext]$Context)

    $req = $Context.Request
    $res = $Context.Response
    $method = $req.HttpMethod
    $headOnly = $method -eq 'HEAD'
    $status = 500
    try {
        if ($method -ne 'GET' -and $method -ne 'HEAD') {
            $status = 405
            $res.AddHeader('Allow', 'GET, HEAD')
            Send-Text $res $status 'Method Not Allowed' $false
            return
        }

        $full = Resolve-RequestPath $req.Url.AbsolutePath
        if ($null -eq $full) {
            $status = 400
            Send-Text $res $status 'Bad Request' $headOnly
            return
        }

        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        if (-not $mimeTypes.ContainsKey($ext) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
            $status = 404
            Send-Text $res $status 'Not Found' $headOnly
            return
        }

        $bytes = [System.IO.File]::ReadAllBytes($full)
        $status = 200
        Send-Response -Response $res -Status $status -ContentType $mimeTypes[$ext] -Body $bytes -HeadOnly $headOnly
    }
    catch [System.Net.HttpListenerException] {
        $status = 499   # client disconnected mid-response
    }
    catch [System.IO.IOException] {
        $status = 500
        try { Send-Text $res $status 'Internal Server Error' $headOnly } catch [System.Exception] { }
    }
    finally {
        Write-AccessLog $method $req.Url.AbsolutePath $status
        try { $res.Close() } catch [System.Exception] { }
    }
}

$prefix = "http://localhost:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
}
catch [System.Net.HttpListenerException] {
    Write-Error "Could not start on $prefix. The port may be in use. Try: .\server.ps1 -Port 8082"
    exit 1
}

try {
    Write-Host ''
    Write-Host '  Pay360 QM Dashboard' -ForegroundColor White
    Write-Host "  Serving $root"
    Write-Host "  Open    $prefix" -ForegroundColor Cyan
    Write-Host '  Local only, no authentication. Press Ctrl+C to stop.'
    Write-Host ''

    if (-not $NoBrowser) { Start-Process $prefix }

    while ($listener.IsListening) {
        $task = $listener.GetContextAsync()
        # Poll so Ctrl+C can interrupt between waits.
        while (-not $task.AsyncWaitHandle.WaitOne(250)) { }
        Invoke-Request -Context $task.GetAwaiter().GetResult()
    }
}
finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
    Write-Host 'Server stopped.'
}
