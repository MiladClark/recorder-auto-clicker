param([string]$Operation,[int]$Code=0,[int]$X=0,[int]$Y=0)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClickerTestInput {
 [StructLayout(LayoutKind.Sequential)] public struct K { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit,Size=40)] public struct I { [FieldOffset(0)] public uint type; [FieldOffset(8)] public K key; }
 [StructLayout(LayoutKind.Sequential)] public struct P { public int x,y; }
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,I[] inputs,int size);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int code);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out P point);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 public static void Key(int code,bool up) { var input=new I{type=1,key=new K{vk=(ushort)code,flags=up?2u:0u}};if(SendInput(1,new[]{input},40)!=1)throw new Exception("SendInput blocked."); }
}
'@
switch($Operation){
 'stopall' { [ClickerTestInput]::Key(17,$false);[ClickerTestInput]::Key(16,$false);[ClickerTestInput]::Key(123,$false);Start-Sleep -Milliseconds 35;[ClickerTestInput]::Key(123,$true);[ClickerTestInput]::Key(16,$true);[ClickerTestInput]::Key(17,$true) }
 'key' { [ClickerTestInput]::Key($Code,$false);Start-Sleep -Milliseconds 35;[ClickerTestInput]::Key($Code,$true) }
 'up' { [ClickerTestInput]::Key($Code,$true) }
 'mouse' {
  $taskDown=2;$taskUp=4;$taskData=0
  switch($Code){2{$taskDown=8;$taskUp=16}4{$taskDown=32;$taskUp=64}5{$taskDown=128;$taskUp=256;$taskData=1}6{$taskDown=128;$taskUp=256;$taskData=2}}
  [ClickerTestInput]::mouse_event($taskDown,0,0,$taskData,[UIntPtr]::Zero);Start-Sleep -Milliseconds 35;[ClickerTestInput]::mouse_event($taskUp,0,0,$taskData,[UIntPtr]::Zero)
 }
 'pressed' { ([ClickerTestInput]::GetAsyncKeyState($Code) -lt 0) | ConvertTo-Json -Compress }
 'move' { [void][ClickerTestInput]::SetCursorPos($X,$Y) }
 'cursor' { $taskPoint=New-Object ClickerTestInput+P;[void][ClickerTestInput]::GetCursorPos([ref]$taskPoint);@{x=$taskPoint.x;y=$taskPoint.y}|ConvertTo-Json -Compress }
 'focus' { [void][ClickerTestInput]::SetForegroundWindow([ClickerTestInput]::FindWindow($null,'FrameCue')) }
}
