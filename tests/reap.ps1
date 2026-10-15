# Windows only: kill orphaned postgres children of the test stacks (parent gone) — they pin
# shared memory and make the next initdb fail with "pre-existing shared memory block".
$all = Get-CimInstance Win32_Process
$alive = @{}; $all | ForEach-Object { $alive[$_.ProcessId] = $true }
$all | Where-Object { $_.Name -eq 'postgres.exe' -and $_.CommandLine -like '*tests*node_modules*embedded-postgres*' -and $_.CommandLine -like '*--forkchild*' -and -not $alive[$_.ParentProcessId] } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
