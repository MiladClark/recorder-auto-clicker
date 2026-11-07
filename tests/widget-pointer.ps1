param([int]$X,[int]$Y,[switch]$Move)
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class WidgetPointer{
 [StructLayout(LayoutKind.Sequential)]public struct Point{public int X;public int Y;}
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
}
'@
if($Move){[WidgetPointer]::SetCursorPos($X,$Y)|Out-Null}
$taskPoint=New-Object WidgetPointer+Point
[WidgetPointer]::GetCursorPos([ref]$taskPoint)|Out-Null
@{x=$taskPoint.X;y=$taskPoint.Y}|ConvertTo-Json -Compress
