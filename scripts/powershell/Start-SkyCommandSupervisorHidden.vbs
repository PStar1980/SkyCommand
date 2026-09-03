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
If args.Count <> 4 Then WScript.Quit 87

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
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
