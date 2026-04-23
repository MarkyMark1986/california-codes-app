# parse_calcrim_pdf.ps1
# Parses calcrim-2026.txt (pre-extracted by pdftotext) into CalCrim instruction records
# and splices them into ca_codes.json as code "CCR".

param(
  [string]$TxtPath   = "C:\Users\optim\Desktop\california-codes-app\calcrim-2026.txt",
  [string]$CodesPath = "C:\Users\optim\Desktop\california-codes-app\ca_codes.json",
  [string]$DumpPath  = "C:\Users\optim\Desktop\california-codes-app\calcrim.json"
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

Write-Host "Reading $TxtPath ..."
$lines = [System.IO.File]::ReadAllLines($TxtPath, [System.Text.Encoding]::UTF8)
Write-Host "  $($lines.Count) lines"

# ---------- Parsing windows (0-indexed line numbers) ----------
# Vol 1 body: lines 2659-59276 (actual instructions 100-1808 series)
# Vol 2 body: lines 61358-120498 (actual instructions 1900-3600 series)
# Index/appendices begin around line 120499 - stop there.
$windows = @(
    @{ start = 2659; end = 59276 },
    @{ start = 61358; end = 120498 }
)

# ---------- Regexes ----------
# Instruction title: 0-15 leading spaces, 3-4 digit number + optional A-Z suffix, period, space(s), title
$titleRe    = [regex]'^(\s{0,15})(\d{3,4}[A-Z]?)\.(?!\d)\s+(.+)'
# Code citation in title or on next line
$citRe      = [regex]'(?:Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code,?\s*[Ss]ection\s+([\d.]+)|(?:Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code,?\s*[Ss]ections?\s+([\d.]+)|(?:Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code,?\s*[Ss]ecs?\.\s+([\d.]+)|(?:Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code,?\s*§+\s*([\d.]+(?:\([a-z]\))?)'
# Simpler citation extractor for building the mapping
$citSimpleRe = [regex]'\(\s*(Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code,?.*?§+\s*([\d.]+)'
$pageHdrRe  = [regex]'CALCRIM\s+No\.'
$pageNumRe  = [regex]'^[\s\f\x0C]*\d{1,4}\s*$'
$revDateRe  = [regex]'^New (January|February|March|April|May|June|July|August|September|October|November|December)'
$reservedRe = [regex]'^\s*\d{3,4}[A-Z]?[\u2013\u2014\-]+\d{3,4}'
$benchRe    = [regex]'BENCH\s+NOTES'
$seriesRe   = [regex]'^(?:\s*SERIES\s+\d+\s+)([A-Z][A-Z ,&/]+)$'
$chapterRe  = [regex]'^\s{2,12}[A-Z]\.\s+([A-Z][A-Z ,&/:\-]+[A-Z])$'

# Map code name prefix to internal code key
$codeNameMap = @{
    'Pen.'                    = 'PEN'
    'Veh.'                    = 'VEH'
    'Health & Saf.'           = 'HSC'
    'Health&Saf.'             = 'HSC'
    'Bus. & Prof.'            = 'BPC'
    'Bus.&Prof.'              = 'BPC'
    'Welf. & Inst.'           = 'WIC'
    'Welf.&Inst.'             = 'WIC'
}

function Map-CodeName([string]$name) {
    foreach ($k in $codeNameMap.Keys) {
        if ($name -match [regex]::Escape($k.Split('.')[0])) { return $codeNameMap[$k] }
    }
    return ''
}

# ---------- Helpers ----------
$stopWords = @{}
"the","and","any","for","this","that","with","from","shall","such","each","under","upon",
"has","have","been","than","when","where","who","which","section","subdivision","paragraph",
"chapter","code","california","person","persons","other","may","not","all","one","two",
"three","four","five","more","less","also","both","either","only","same","without","no",
"be","or","in","of","a","an","is","are","was","were","by","as","at","to","if","on",
"its","it","he","she","they","their","his","her","them","must","prove","defendant","people",
"guilty","crime","charged","count","violation","find","whether","beyond","reasonable","doubt",
"did","does","not","had","have","has","would","could","should" | ForEach-Object { $stopWords[$_] = 1 }

function Build-Keywords([string]$text) {
    if (-not $text) { return "" }
    $words = ($text -replace "[^a-zA-Z\s]"," ").ToLower() -split "\s+" |
             Where-Object { $_ -and $_.Length -gt 3 -and -not $stopWords.ContainsKey($_) } |
             Group-Object | Sort-Object Count -Descending | Select-Object -First 10 |
             ForEach-Object { $_.Name }
    return ($words -join ",")
}

function Get-OffenseClass([string]$text) {
    $tl  = $text.ToLower()
    $cls = "unknown"
    if ($tl -match "infraction|fine only")                                                    { $cls = "infraction" }
    if ($tl -match "misdemeanor|county jail")                                                 { $cls = "misdemeanor" }
    if ($tl -match "felony|felonious|state prison|imprisonment pursuant to subdivision \(h\)"){ $cls = "felony" }
    if ($cls -notin "unknown","infraction" -and
        $tl -match "(felony|misdemeanor).{0,120}(misdemeanor|felony)")                        { $cls = "felony/misdemeanor" }
    return $cls
}

function Extract-Citation([string]$titleLine) {
    # Returns a string like "Pen. Code, § 187" or ""
    $m = [regex]::Match($titleLine, '\(((?:Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code[^)]*)\)')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return ""
}

# Build mapping: "PEN-187" -> ["520"], etc.
$codeMapping = @{}   # key: "CODE-section", value: list of CalCrim numbers

function Add-Mapping([string]$citLine, [string]$instrNum) {
    # Extract all code+section pairs from a line
    $ms = [regex]::Matches($citLine, '\((Pen\.|Veh\.|Health\s*[&]\s*Saf\.|Bus\.\s*[&]\s*Prof\.|Welf\.\s*[&]\s*Inst\.)\s*Code,?\s*\u00A7+\s*([\d.]+(?:\([a-z]\))?)')
    foreach ($m in $ms) {
        $codePfx = $m.Groups[1].Value
        $sec     = $m.Groups[2].Value -replace '\([a-z]\)',''  # strip sub like (a)
        $codeKey = ''
        if ($codePfx -match 'Pen\.')         { $codeKey = 'PEN' }
        elseif ($codePfx -match 'Veh\.')     { $codeKey = 'VEH' }
        elseif ($codePfx -match 'Health')    { $codeKey = 'HSC' }
        elseif ($codePfx -match 'Bus\.')     { $codeKey = 'BPC' }
        elseif ($codePfx -match 'Welf\.')    { $codeKey = 'WIC' }
        if (-not $codeKey) { continue }
        $mapKey = "$codeKey-$sec"
        if (-not $codeMapping.ContainsKey($mapKey)) { $codeMapping[$mapKey] = [System.Collections.Generic.List[string]]::new() }
        if (-not $codeMapping[$mapKey].Contains($instrNum)) { $codeMapping[$mapKey].Add($instrNum) }
    }
}

# ---------- Parse ----------
$sections = [System.Collections.ArrayList]::new()
$curNum   = $null
$curTitle = ""
$curCit   = ""
$curPart  = ""
$curBody  = [System.Text.StringBuilder]::new()
$inBody   = $false   # true once we've seen actual body text (not just title+citation)

function Flush-Section {
    if (-not $script:curNum) { return }
    $body = $script:curBody.ToString().Trim()
    $body = [regex]::Replace($body, "\s{2,}", " ")
    $body = $body.Trim()
    if ($body.Length -lt 20) {
        $script:curNum = $null; $script:curTitle = ""; $script:curCit = ""
        $script:curBody.Clear() | Out-Null; $script:inBody = $false
        return
    }
    [void]$script:sections.Add([pscustomobject]@{
        id            = "CCR-" + $script:curNum
        code          = "CCR"
        sectionNumber = $script:curNum
        title         = $script:curTitle
        codeCitation  = $script:curCit
        partInfo      = $script:curPart
        chapterInfo   = ""
        text          = $body
        offenseClass  = Get-OffenseClass $body
        keywords      = Build-Keywords ($script:curTitle + " " + $body)
        sourceUrl     = "https://courts.ca.gov/system/files/file/calcrim-2026.pdf"
    })
    $script:curNum = $null; $script:curTitle = ""; $script:curCit = ""
    $script:curBody.Clear() | Out-Null; $script:inBody = $false
}

$prevLineWasTitle = $false
$prevTitle        = ""
$prevNum          = ""
$prevPart         = ""

foreach ($win in $windows) {
    Write-Host "  Parsing lines $($win.start+1)-$($win.end+1) ..."
    for ($i = $win.start; $i -le $win.end; $i++) {
        $line = $lines[$i]

        # Remove form feeds
        $line = $line -replace "[\f\x0C]", ""

        # Skip lines containing CALCRIM No. (page headers / cross-references at top of page)
        if ($pageHdrRe.IsMatch($line)) {
            $prevLineWasTitle = $false
            continue
        }

        # Detect series headers for partInfo tracking
        $sm = $seriesRe.Match($line)
        if ($sm.Success) {
            $curPart = $sm.Groups[1].Value.Trim()
            $prevLineWasTitle = $false
            continue
        }

        # Detect instruction title line
        $tm = $titleRe.Match($line)
        if ($tm.Success -and -not $reservedRe.IsMatch($line)) {
            $num   = $tm.Groups[2].Value
            $title = $tm.Groups[3].Value.Trim()

            # Flush previous instruction
            Flush-Section

            $curNum   = $num
            $curTitle = $title
            $curCit   = Extract-Citation $line
            $curPart  = if ($curPart) { $curPart } else { "" }
            $inBody   = $false
            $prevLineWasTitle = $true

            # Build mapping from this title line
            if ($curCit) { Add-Mapping $line $num }
            continue
        }

        # If previous line was the title, the next non-empty line may be a code citation
        if ($prevLineWasTitle -and $line -match '^\s*\(.*Code') {
            if (-not $curCit) {
                $curCit = Extract-Citation $line
            }
            if ($curCit) { Add-Mapping $line $curNum }
            # Don't add this to body
            $prevLineWasTitle = $false
            continue
        }

        # Preserve prevLineWasTitle through blank lines - check BEFORE resetting it
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0) {
            if ($curNum -and $inBody -and $curBody.Length -gt 0) {
                [void]$curBody.Append(" ")
            }
            continue   # blank lines do NOT reset prevLineWasTitle
        }

        $prevLineWasTitle = $false

        # Skip if no current instruction
        if (-not $curNum) { continue }

        # Stop body at BENCH NOTES
        if ($benchRe.IsMatch($trimmed)) {
            Flush-Section
            continue
        }

        # Stop body at revision date line
        if ($revDateRe.IsMatch($trimmed)) {
            Flush-Section
            continue
        }

        # Skip standalone page numbers
        if ($pageNumRe.IsMatch($trimmed)) { continue }

        # Skip "Reserved for Future Use" filler lines
        if ($trimmed -match "Reserved for Future Use") { continue }

        # Skip supplement header lines like "2026 S-29"
        if ($trimmed -match "^\d{4}\s+S-\d+") { continue }

        # Skip chapter/section letter headers (they're structural, not body text)
        # e.g., "A. GENERAL INSTRUCTIONS" or "   C. MURDER: FIRST AND SECOND DEGREE"
        if ($trimmed -match "^[A-Z]\.\s+[A-Z][A-Z ,&/:\-]+$") { continue }
        if ($trimmed -match "^\([ivxIVX]+\)\s") { continue }

        # This is body text
        $inBody = $true
        if ($curBody.Length -gt 0 -and -not ($curBody.ToString()[-1] -eq ' ')) {
            [void]$curBody.Append(" ")
        }
        [void]$curBody.Append($trimmed)
    }
    Flush-Section  # flush last instruction of this window
}

Write-Host ""
Write-Host "Parsed $($sections.Count) CalCrim instructions"
Write-Host "Built $($codeMapping.Count) code-section mappings"

# ---------- Save intermediate dump ----------
Write-Host "Saving $DumpPath ..."

# Convert mapping to simple key->first-value for JSON (most sections have only one instruction)
$mappingObj = [System.Collections.Specialized.OrderedDictionary]::new()
foreach ($k in ($codeMapping.Keys | Sort-Object)) {
    $mappingObj[$k] = ($codeMapping[$k] -join ",")
}

$dump = [pscustomobject]@{
    metadata = [pscustomobject]@{
        source        = "California Criminal Jury Instructions (CALCRIM)"
        edition       = "2026"
        publisher     = "Judicial Council of California / LexisNexis Matthew Bender"
        lastUpdated   = "2026-02-01"
        totalSections = $sections.Count
    }
    codeMapping = $mappingObj
    sections    = $sections
}
[System.IO.File]::WriteAllText($DumpPath, ($dump | ConvertTo-Json -Depth 6 -Compress), $utf8NoBom)
Write-Host "  Saved ($([Math]::Round((Get-Item $DumpPath).Length / 1KB, 0)) KB)"

# ---------- Splice into ca_codes.json ----------
Write-Host "Splicing into $CodesPath ..."

$codesBytes = [System.IO.File]::ReadAllBytes($CodesPath)
# Read last 5000 bytes to reliably detect if CCR key is already present
$tailStart  = [Math]::Max(0, $codesBytes.Length - 5000)
$tailBytes  = $codesBytes[$tailStart..($codesBytes.Length - 1)]
$tailText   = [System.Text.Encoding]::UTF8.GetString($tailBytes)

if ($tailText -match '"CCR"') {
    Write-Host "  CCR key already present -- skipping splice."
} else {
    $ccrArr = $sections | ConvertTo-Json -Depth 6 -Compress
    if ($sections.Count -eq 1) { $ccrArr = "[" + $ccrArr + "]" }

    $ccrBlock = ',"CCR":{"name":"California Criminal Jury Instructions (CALCRIM)","abbreviation":"CALCRIM","sections":' + $ccrArr + '}}}'
    $ccrBytes = $utf8NoBom.GetBytes($ccrBlock)

    $trimLen  = $codesBytes.Length - 2
    $outBytes = [byte[]]::new($trimLen + $ccrBytes.Length)
    [System.Array]::Copy($codesBytes, $outBytes, $trimLen)
    [System.Array]::Copy($ccrBytes, 0, $outBytes, $trimLen, $ccrBytes.Length)
    [System.IO.File]::WriteAllBytes($CodesPath, $outBytes)

    $mb = [Math]::Round($outBytes.Length / 1MB, 1)
    Write-Host "  ca_codes.json updated - now $mb MB"
}

# ---------- Print mapping snippet for app.js ----------
Write-Host ""
Write-Host "=== Top 30 code->CalCrim mappings (for app.js CALCRIM_MAP) ==="
$count = 0
foreach ($k in ($codeMapping.Keys | Sort-Object)) {
    $vals = $codeMapping[$k] -join ","
    Write-Host "  '$k': '$vals',"
    $count++
    if ($count -ge 30) { Write-Host "  ... ($($codeMapping.Count - 30) more)"; break }
}

Write-Host ""
Write-Host "Done!  CalCrim instructions: $($sections.Count)"
