# 只截桌宠窗口所在的那一小块屏幕（不截其他区域），用于检查桌宠在桌面上的样子。
# 用法：powershell -File scripts/capture-pet.ps1 <x> <y> <宽> <高> <缩放比例> <输出.png> [外扩像素]
# x、y、宽、高是 Electron 的逻辑像素（DIP），会按缩放比例换成物理像素。
# 透明窗口是分层窗口，普通截屏截不到，这里直接用 BitBlt 加 CAPTUREBLT。
param([int]$X, [int]$Y, [int]$W, [int]$H, [double]$Scale, [string]$Out, [int]$Pad = 20)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Gdi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
}
"@
[Gdi]::SetProcessDPIAware() | Out-Null
$px = [int](($X - $Pad) * $Scale); $py = [int](($Y - $Pad) * $Scale)
$pw = [int](($W + 2 * $Pad) * $Scale); $ph = [int](($H + 2 * $Pad) * $Scale)
$bmp = New-Object System.Drawing.Bitmap $pw, $ph
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dst = $g.GetHdc()
$screen = [Gdi]::GetDC([IntPtr]::Zero)
[Gdi]::BitBlt($dst, 0, 0, $pw, $ph, $screen, $px, $py, 0x40CC0020) | Out-Null   # SRCCOPY | CAPTUREBLT
[Gdi]::ReleaseDC([IntPtr]::Zero, $screen) | Out-Null
$g.ReleaseHdc($dst)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $Out ($pw x $ph)"
