$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskCopy=New-Object System.Windows.Forms.DataObject
$taskOriginal=[System.Windows.Forms.Clipboard]::GetDataObject()
if($null -ne $taskOriginal){
 foreach($taskFormat in $taskOriginal.GetFormats($false)){
  try{
   $taskData=$taskOriginal.GetData($taskFormat,$false)
   if($taskData -is [Drawing.Image]){$taskData=$taskData.Clone()}
   if($null -ne $taskData){$taskCopy.SetData($taskFormat,$false,$taskData)}
  }catch{}
 }
}
[Console]::WriteLine('READY')
[Console]::Out.Flush()
try{[Console]::ReadLine() | Out-Null}finally{
 if($taskCopy.GetFormats($false).Length){[System.Windows.Forms.Clipboard]::SetDataObject($taskCopy,$true)}else{[System.Windows.Forms.Clipboard]::Clear()}
}
