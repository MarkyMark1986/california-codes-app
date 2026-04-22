# scrape_wic.ps1
# Fetches specific WIC sections from leginfo and splices them into ca_codes.json.

param(
  [string]$CodesPath = "C:\Users\optim\Desktop\california-codes-app\ca_codes.json",
  [int]   $DelayMs   = 1200
)

$ErrorActionPreference = "Continue"
$tempHtml  = "$env:TEMP\leginfo_wic.html"
$secBase   = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$sectionNums = @(
    # Mental Health Holds
    "5150", "5151", "5152", "5250", "5270", "5300",
    # Minors - Delinquency
    "601", "601.5", "602", "602.3", "707", "707.1",
    # Child Abuse & Neglect
    "300", "308",
    # Misc - field contacts, probation violations
    "625", "628", "777"
)

# ---------- helpers (same as fix_truncated_sections.ps1) ----------

function Fetch-Page([string]$url) {
    & curl.exe -s --connect-timeout 20 --max-time 60 `
        -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" `
        -o $tempHtml $url 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempHtml)) { return $null }
    try   { return [System.IO.File]::ReadAllText($tempHtml, [System.Text.Encoding]::UTF8) }
    catch { return $null }
}

function Strip-Html([string]$html) {
    if (-not $html) { return "" }
    $t = $html -replace "<[^>]+>", " "
    $t = $t    -replace "&amp;",  "&"
    $t = $t    -replace "&lt;",   "<"
    $t = $t    -replace "&gt;",   ">"
    $t = $t    -replace "&nbsp;", " "
    $t = $t    -replace "&#160;", " "
    $t = $t    -replace "&#39;",  "'"
    $t = $t    -replace "&quot;", '"'
    $t = $t    -replace "\s{2,}", " "
    return $t.Trim()
}

function Fix-Encoding([string]$t) {
    $t = $t -replace ([char]0x00e2 + [char]0x20ac + [char]0x2122), "'"
    $t = $t -replace ([char]0x00e2 + [char]0x20ac + [char]0x0153), '"'
    $t = $t -replace ([char]0x00e2 + [char]0x20ac + [char]0x009d), '"'
    $t = $t -replace ([char]0x00e2 + [char]0x20ac + [char]0x2014), "-"
    $t = $t -replace ([char]0x00c2 + [char]0x00a0), " "
    $t = $t -replace [char]0x00c2, ""
    $t = $t -replace [char]0x00c3, ""
    $t = $t -replace "[\u0080-\u009f]", ""
    $t = $t -replace "  +", " "
    return $t.Trim()
}

function Parse-SectionPage([string]$html) {
    if (-not $html -or $html -notmatch 'id="single_law_section"') { return $null }
    $opts    = [System.Text.RegularExpressions.RegexOptions]::Singleline
    $wrapper = [regex]::Match($html, 'id="single_law_section"[^>]*>(.*)', $opts)
    if (-not $wrapper.Success) { return $null }
    $inner   = $wrapper.Groups[1].Value

    $h6m     = [regex]::Match($inner, '<h6[^>]*>(.*?)</h6>(.*)', $opts)
    $h6text  = if ($h6m.Success) { Strip-Html $h6m.Groups[1].Value } else { "" }
    $afterH6 = if ($h6m.Success) { $h6m.Groups[2].Value } else { $inner }

    $sb  = [System.Text.StringBuilder]::new()
    $pms = [regex]::Matches($afterH6, '<p([^>]*)>(.*?)</p>', $opts)
    foreach ($pm in $pms) {
        $attr = $pm.Groups[1].Value
        $body = $pm.Groups[2].Value
        if ($attr -match "clear:both|font-size:0\.9") { continue }
        $pt   = Strip-Html $body
        if ($pt -match "^\s*\((Amended|Added|Repealed|Formerly|Stats\.)") { continue }
        if ($pt.Length -lt 4) { continue }
        if ($sb.Length -gt 0) { [void]$sb.Append(" ") }
        [void]$sb.Append($pt)
    }

    $raw = $sb.ToString().Trim()
    if (-not $raw) { return $null }
    return @{ text = Fix-Encoding $raw; h6 = $h6text }
}

# Extract title from h6: "5150." -> "" | "5150. [Title text]" -> "Title text"
function Extract-Title([string]$h6, [string]$secNum) {
    if (-not $h6) { return "" }
    $t = $h6 -replace "^\s*$([regex]::Escape($secNum))\s*\.\s*", ""
    $t = $t.Trim().TrimEnd(".")
    return $t
}

$stopWords = @{}
"the","and","any","for","this","that","with","from","shall","such","each","under","upon",
"has","have","been","than","when","where","who","which","section","subdivision","paragraph",
"chapter","code","california","person","persons","other","may","not","all","one","two",
"three","four","five","more","less","also","both","either","only","same","without","no",
"be","or","in","of","a","an","is","are","was","were","by","as","at","to","if","on",
"its","it","he","she","they","their","his","her","them" | ForEach-Object { $stopWords[$_] = 1 }

function Build-Keywords([string]$text) {
    if (-not $text) { return "" }
    $words = ($text -replace "[^a-zA-Z\s]"," ").ToLower() -split "\s+" |
             Where-Object { $_ -and $_.Length -gt 3 -and -not $stopWords.ContainsKey($_) } |
             Group-Object | Sort-Object Count -Descending | Select-Object -First 8 |
             ForEach-Object { $_.Name }
    return ($words -join ",")
}

function Get-OffenseClass([string]$text) {
    $tl  = $text.ToLower()
    $cls = "unknown"
    if ($tl -match "infraction|punished by a fine only")                                        { $cls = "infraction" }
    if ($tl -match "misdemeanor|imprisonment in (a )?county jail")                              { $cls = "misdemeanor" }
    if ($tl -match "felony|felonious|state prison|imprisonment pursuant to subdivision \(h\)")  { $cls = "felony" }
    if ($cls -notin "unknown","infraction" -and
        $tl -match "(felony|misdemeanor).{0,120}(misdemeanor|felony)")                          { $cls = "felony/misdemeanor" }
    return $cls
}

# ---------- scrape ----------

$sections = [System.Collections.ArrayList]::new()
$errors   = 0
$total    = $sectionNums.Count

Write-Host "Scraping $total WIC sections from leginfo..."

for ($i = 0; $i -lt $total; $i++) {
    $num = $sectionNums[$i]
    $url = "${secBase}?sectionNum=${num}.&lawCode=WIC"
    Write-Host "  [$($i+1)/$total] WIC $num ..."

    $html = Fetch-Page $url
    if (-not $html) {
        Write-Host "    ERROR: fetch failed"
        $errors++
        Start-Sleep -Milliseconds $DelayMs
        continue
    }

    $parsed = Parse-SectionPage $html
    if (-not $parsed -or -not $parsed.text) {
        Write-Host "    ERROR: parse failed (no section content in page)"
        $errors++
        Start-Sleep -Milliseconds $DelayMs
        continue
    }

    $title = Extract-Title $parsed.h6 $num
    $text  = $parsed.text
    Write-Host "    OK  len=$($text.Length)  title='$title'"

    [void]$sections.Add([pscustomobject]@{
        id            = "WIC-$num"
        code          = "WIC"
        sectionNumber = $num
        title         = $title
        partInfo      = ""
        chapterInfo   = ""
        text          = $text
        offenseClass  = Get-OffenseClass $text
        keywords      = Build-Keywords $text
        sourceUrl     = $url
    })

    Start-Sleep -Milliseconds $DelayMs
}

Write-Host ""
Write-Host "Fetched $($sections.Count) sections  ($errors errors)"

if ($sections.Count -eq 0) {
    Write-Host "Nothing to add - aborting."
    exit 1
}

# ---------- splice into ca_codes.json ----------
Write-Host "Splicing into $CodesPath ..."

$codesBytes = [System.IO.File]::ReadAllBytes($CodesPath)
$tailBytes  = $codesBytes[([Math]::Max(0, $codesBytes.Length - 300))..($codesBytes.Length - 1)]
$tailText   = [System.Text.Encoding]::UTF8.GetString($tailBytes)

if ($tailText -match '"WIC"') {
    Write-Host "  WIC key already present -- skipping splice."
} else {
    $wicArr = $sections | ConvertTo-Json -Depth 6 -Compress
    if ($sections.Count -eq 1) { $wicArr = "[" + $wicArr + "]" }

    # File ends with ]}}}: last-section} sections] code-obj} codes-obj} root-obj}
    # Strip last 2 bytes (codes-obj + root-obj), append WIC block + }}}
    $trimLen  = $codesBytes.Length - 2
    $wicBlock = ',"WIC":{"name":"Welfare and Institutions Code","abbreviation":"WI","sections":' + $wicArr + '}}}'
    $wicBytes = $utf8NoBom.GetBytes($wicBlock)

    $outBytes = [byte[]]::new($trimLen + $wicBytes.Length)
    [System.Array]::Copy($codesBytes, $outBytes, $trimLen)
    [System.Array]::Copy($wicBytes, 0, $outBytes, $trimLen, $wicBytes.Length)
    [System.IO.File]::WriteAllBytes($CodesPath, $outBytes)

    $mb = [Math]::Round($outBytes.Length / 1MB, 1)
    Write-Host "  ca_codes.json updated - now $mb MB"
}

Write-Host ""
Write-Host "Done."
