Option Explicit

Const InvalidArguments = 87

Dim shell
Dim powerShellPath
Dim scriptPath
Dim command
Dim argumentIndex
Dim exitCode

If WScript.Arguments.Count < 1 Then
    WScript.Quit InvalidArguments
End If

Set shell = CreateObject("WScript.Shell")
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
scriptPath = WScript.Arguments(0)

command = QuoteArgument(powerShellPath) & _
    " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & _
    QuoteArgument(scriptPath)

For argumentIndex = 1 To WScript.Arguments.Count - 1
    command = command & " " & QuoteArgument(WScript.Arguments(argumentIndex))
Next

' Window style 0 starts PowerShell fully hidden. True waits so Task Scheduler
' receives the real exit code and continues to enforce its instance policy.
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(ByVal value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
