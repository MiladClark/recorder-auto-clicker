param([int]$StartX,[int]$StartY,[int]$EndX,[int]$EndY)
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class WidgetDragInput{
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
}
'@
[WidgetDragInput]::SetCursorPos($StartX,$StartY)|Out-Null
Start-Sleep -Milliseconds 100
[WidgetDragInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
try{
 Start-Sleep -Milliseconds 140
 for($taskStep=1;$taskStep -le 16;$taskStep++){
  $taskRatio=$taskStep/16
  [WidgetDragInput]::SetCursorPos([int]($StartX+($EndX-$StartX)*$taskRatio),[int]($StartY+($EndY-$StartY)*$taskRatio))|Out-Null
  Start-Sleep -Milliseconds 24
 }
}finally{[WidgetDragInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
