Option Explicit

Dim args
Dim powershellPath
Dim runnerScript
Dim repositoryRoot
Dim nodePath
Dim commandLine
Dim shell
Dim exitCode

Set args = WScript.Arguments

If args.Count <> 4 Then
    WScript.Quit 87
End If

powershellPath = args.Item(0)
runnerScript = args.Item(1)
repositoryRoot = args.Item(2)
nodePath = args.Item(3)

commandLine = QuoteArgument(powershellPath) _
    & " -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " _
    & QuoteArgument(runnerScript) _
    & " -RepositoryRoot " & QuoteArgument(repositoryRoot) _
    & " -NodePath " & QuoteArgument(nodePath)

Set shell = CreateObject("WScript.Shell")

' Window style 0 launches the PowerShell runner hidden. Because wscript.exe is a
' GUI-subsystem executable, Task Scheduler does not need to attach a console or
' Windows Terminal surface before the hidden PowerShell -> Node chain starts.
' WaitOnReturn=True preserves task ownership and returns the worker exit code.
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
