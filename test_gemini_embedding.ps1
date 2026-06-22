# Read API key from .env file
$envFile = ".\.env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile
    $keyLine = $envContent | Where-Object { $_ -match "^VITE_Gemini_API=" }
    if ($keyLine) {
        $key = ($keyLine -split "=", 2)[1].Trim()
    } else {
        $key = Read-Host "Gemini API Key not found in .env. Enter your key"
    }
} else {
    $key = Read-Host "Enter your Gemini API Key"
}


$url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=$key"

$body = @{
    model = "models/gemini-embedding-2"
    content = @{
        parts = @(
            @{ text = "Testing the embedding values for this text." }
        )
    }
} | ConvertTo-Json -Depth 5 -Compress

$headers = @{
    "Content-Type" = "application/json"
}

Write-Host "Calling Gemini API..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
    
    if ($null -ne $response.embedding.values) {
        $values = $response.embedding.values
        Write-Host "[SUCCESS] API call successful!" -ForegroundColor Green
        Write-Host "Embedding Dimensions: $($values.Count)" -ForegroundColor Yellow
        Write-Host "First 5 values: $($values[0..4] -join ', ')..."
    } else {
        Write-Host "[WARNING] API call succeeded but no embedding values were returned." -ForegroundColor Yellow
        $response | ConvertTo-Json -Depth 5
    }
} catch {
    Write-Host "[ERROR] API call failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    
    if ($_.ErrorDetails) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}
