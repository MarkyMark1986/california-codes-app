# parse_eureka_pdf.ps1
# Parses eureka-ca-1.pdf and splices EMC sections into ca_codes.json.

param(
  [string]$PdfPath   = "C:\Users\optim\Desktop\california-codes-app\eureka-ca-1.pdf",
  [string]$CodesPath = "C:\Users\optim\Desktop\california-codes-app\ca_codes.json",
  [string]$DumpPath  = "C:\Users\optim\Desktop\california-codes-app\eureka_muni.json"
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$tempTxt   = "$env:TEMP\eureka_raw.txt"

# ---------- 1. Extract PDF text (UTF-8) ----------
Write-Host "Extracting PDF text..."
& pdftotext -layout -enc UTF-8 $PdfPath $tempTxt 2>$null
if (-not (Test-Path $tempTxt)) { throw "pdftotext failed" }
$lines = [System.IO.File]::ReadAllLines($tempTxt, [System.Text.Encoding]::UTF8)
Write-Host "  $($lines.Count) lines extracted"

# ---------- 2. Helpers ----------
$stopWords = @{}
"the","and","any","for","this","that","with","from","shall","such","each","under","upon",
"has","have","been","than","when","where","who","which","section","subdivision","paragraph",
"chapter","code","city","eureka","person","persons","other","may","not","all","one","two",
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
    if ($tl -match "infraction|punished by a fine only")                             { $cls = "infraction" }
    if ($tl -match "misdemeanor|imprisonment in (a )?county jail")                   { $cls = "misdemeanor" }
    if ($tl -match "felony|felonious|state prison")                                  { $cls = "felony" }
    if ($cls -notin "unknown","infraction" -and
        $tl -match "(felony|misdemeanor).{0,120}(misdemeanor|felony)")               { $cls = "felony/misdemeanor" }
    return $cls
}

function To-TitleCase([string]$s) {
    if (-not $s) { return "" }
    # Convert only all-caps strings (no lowercase letters)
    if ($s -cmatch "^[^a-z]+$") {
        return (Get-Culture).TextInfo.ToTitleCase($s.ToLower())
    }
    return $s
}

# ---------- 3. Patterns ----------
$secSign    = [char]0x00A7
$muniSecRe  = "^" + [regex]::Escape([string]$secSign) + "\s+(\d+\.\d+[A-Z0-9]*)\s+(.+)"
$charSecRe  = "^SECTION\s+(\d+)\.\s+(.+)"
$titleHdrRe = "^\s{0,12}TITLE\s+[IVXivx\d]+\s*[:\.]"
$chapHdrRe  = "^\s{0,12}CHAPTER\s+\d+\s*:"
$artHdrRe   = "^\s*ARTICLE\s+[IVX]+"
$tocEntryRe = "^\d+[A-Z]*\.\d+[A-Z0-9]*\s+[A-Za-z]"
$chapListRe = "^\d+\.\s+[A-Z][A-Z ,]+$"
$subHeadRe  = "^[A-Z][A-Z ,;/\-&]+[A-Z]$"

# ---------- 4. Parse ----------
$sections = [System.Collections.ArrayList]::new()
$curNum   = $null
$curTitle = ""
$curPart  = ""
$curChap  = ""
$curBody  = [System.Text.StringBuilder]::new()
$stopped  = $false

function Flush-Section {
    if (-not $script:curNum) { return }
    $body = $script:curBody.ToString().Trim()
    $body = [regex]::Replace($body, "\s{2,}", " ")
    if ($body.Length -gt 20) {
        [void]$script:sections.Add([pscustomobject]@{
            id            = "EMC-" + $script:curNum
            code          = "EMC"
            sectionNumber = $script:curNum
            title         = $script:curTitle
            partInfo      = $script:curPart
            chapterInfo   = $script:curChap
            text          = $body
            offenseClass  = Get-OffenseClass $body
            keywords      = Build-Keywords $body
            sourceUrl     = "https://codelibrary.amlegal.com/codes/eureka/latest/overview"
        })
    }
    $script:curNum = $null
    $script:curTitle = ""
    $script:curBody.Clear() | Out-Null
}

foreach ($line in $lines) {
    if ($line -match "PARALLEL REFERENCES|TABLE OF SPECIAL ORDINANCES") {
        Flush-Section; $stopped = $true
    }
    if ($stopped) { continue }

    if ($line -match $titleHdrRe) {
        Flush-Section; $curPart = $line.Trim(); $curChap = ""; continue
    }
    if ($line -match $chapHdrRe) {
        Flush-Section; $curChap = $line.Trim(); continue
    }
    if ($line -match $artHdrRe) {
        Flush-Section; $curPart = $line.Trim(); continue
    }
    if ($line -match $muniSecRe) {
        Flush-Section
        $script:curNum   = $Matches[1]
        $script:curTitle = To-TitleCase $Matches[2].Trim().TrimEnd(".")
        continue
    }
    if ($line -match $charSecRe) {
        Flush-Section
        $script:curNum   = "CHARTER." + $Matches[1]
        $script:curTitle = To-TitleCase $Matches[2].Trim().TrimEnd(".")
        continue
    }

    if (-not $curNum) { continue }

    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0) { continue }

    # Skip citation / amendment history lines
    # Matches: ('63 Code...) or (Ord. ...) or (Am. Ord. ...) etc.
    if ($trimmed -match "^\(('|`)63\s+Code" -or
        $trimmed -match "^\(Ord\." -or
        $trimmed -match "^\(Am\.\s*Ord\." -or
        $trimmed -match "^\(Amended\s+by" -or
        $trimmed -match "^\(Added\s+by" -or
        $trimmed -match "^\(Formerly" -or
        $trimmed -match "^\(Stats\.") { continue }

    # Skip TOC index entries like "10.35 Purpose" (short decimal-num + word)
    if ($trimmed -match $tocEntryRe -and $trimmed.Length -lt 80) { continue }
    # Skip chapter-list entries like "30. CITY COUNCIL"
    if ($trimmed -match $chapListRe -and $trimmed.Length -lt 60) { continue }
    # Skip structural keywords
    if ($trimmed -match "^(Section|Chapter|Article)$") { continue }
    # Skip standalone subchapter headings like "ADMINISTRATIVE CITATIONS"
    if ($trimmed -match $subHeadRe -and $trimmed.Length -ge 6 -and
        $trimmed.Length -le 60 -and $trimmed -notmatch "\d") { continue }
    # Skip supplement / page header lines
    if ($trimmed -match "^\d{4}\s+S-\d+") { continue }

    if ($curBody.Length -gt 0) { [void]$curBody.Append(" ") }
    [void]$curBody.Append($trimmed)
}
Flush-Section

Write-Host "  Parsed $($sections.Count) EMC sections"

# ---------- 5. Save intermediate dump ----------
Write-Host "Saving $DumpPath ..."
$dump = [pscustomobject]@{
    metadata = [pscustomobject]@{
        source        = "Eureka Municipal Code"
        version       = "2026 S-29"
        lastUpdated   = "2026-03-03"
        totalSections = $sections.Count
    }
    sections = $sections
}
[System.IO.File]::WriteAllText($DumpPath, ($dump | ConvertTo-Json -Depth 6 -Compress), $utf8NoBom)
Write-Host "  Saved ($([Math]::Round((Get-Item $DumpPath).Length / 1KB, 0)) KB)"

# ---------- 6. Splice into ca_codes.json ----------
Write-Host "Splicing into $CodesPath ..."

$codesBytes = [System.IO.File]::ReadAllBytes($CodesPath)
# Safety check: read last 300 bytes as text to see if EMC already present
$tailBytes = $codesBytes[([Math]::Max(0, $codesBytes.Length - 300))..($codesBytes.Length - 1)]
$tailText  = [System.Text.Encoding]::UTF8.GetString($tailBytes)
if ($tailText -match '"EMC"') {
    Write-Host "  EMC key already present in ca_codes.json -- skipping splice."
} else {
    $emcArr = $sections | ConvertTo-Json -Depth 6 -Compress
    if ($sections.Count -eq 1) { $emcArr = "[" + $emcArr + "]" }
    if ($sections.Count -eq 0) { $emcArr = "[]" }

    # File ends with: ...last-BPC-section-obj}] BPC-sections] BPC-obj} codes-obj} root-obj}
    # i.e. the last 3 bytes are: } } }  (BPC-obj, codes-obj, root-obj)
    # Strip the last 2 (codes-obj and root-obj), append EMC entry + }}}
    $trimLen  = $codesBytes.Length - 2
    $emcBlock = ',"EMC":{"name":"Eureka Municipal Code","abbreviation":"EMC","sections":' + $emcArr + '}}}'
    $emcBytes = $utf8NoBom.GetBytes($emcBlock)

    $outBytes = [byte[]]::new($trimLen + $emcBytes.Length)
    [System.Array]::Copy($codesBytes, $outBytes, $trimLen)
    [System.Array]::Copy($emcBytes, 0, $outBytes, $trimLen, $emcBytes.Length)
    [System.IO.File]::WriteAllBytes($CodesPath, $outBytes)

    $mb = [Math]::Round($outBytes.Length / 1MB, 1)
    Write-Host "  ca_codes.json updated - now $mb MB"
}

Write-Host ""
Write-Host "Done!  EMC sections: $($sections.Count)"
