use base64::Engine;
use std::io::Cursor;
use std::path::PathBuf;

#[derive(Clone, serde::Serialize)]
pub struct ScreenCaptureResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

pub fn capture_rect(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<ScreenCaptureResult, String> {
    #[cfg(windows)]
    {
        let bytes = unsafe { capture_gdi_rect(x, y, width as i32, height as i32) }?;
        Ok(ScreenCaptureResult {
            data_url: format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ),
            width,
            height,
        })
    }
    #[cfg(not(windows))]
    Err("Screen capture requires Windows.".into())
}

#[cfg(windows)]
unsafe fn capture_gdi_rect(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CAPTUREBLT, CreateCompatibleBitmap,
        CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, RGBQUAD,
        ReleaseDC, SRCCOPY, SelectObject,
    };

    if width <= 0 || height <= 0 || (width as i64) * (height as i64) > 100_000_000 {
        return Err("Invalid capture dimensions.".into());
    }
    let hdc_screen = unsafe { GetDC(std::ptr::null_mut()) };
    if hdc_screen.is_null() {
        return Err("Failed to get screen DC".into());
    }

    let hdc_mem = unsafe { CreateCompatibleDC(hdc_screen) };
    if hdc_mem.is_null() {
        unsafe { ReleaseDC(std::ptr::null_mut(), hdc_screen) };
        return Err("Failed to create memory DC".into());
    }

    let h_bitmap = unsafe { CreateCompatibleBitmap(hdc_screen, width, height) };
    if h_bitmap.is_null() {
        unsafe {
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
        }
        return Err("Failed to create compatible bitmap".into());
    }

    let old_bmp = unsafe { SelectObject(hdc_mem, h_bitmap) };

    let success = unsafe {
        BitBlt(
            hdc_mem,
            0,
            0,
            width,
            height,
            hdc_screen,
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        )
    };

    if success == 0 {
        unsafe {
            SelectObject(hdc_mem, old_bmp);
            DeleteObject(h_bitmap);
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
        }
        return Err("BitBlt screen capture failed".into());
    }

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: (width * height * 4) as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }; 1],
    };

    let mut raw_pixels = vec![0u8; (width * height * 4) as usize];
    let scanlines = unsafe {
        SelectObject(hdc_mem, old_bmp);
        let lines = GetDIBits(
            hdc_mem,
            h_bitmap,
            0,
            height as u32,
            raw_pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Clean up GDI objects
        SelectObject(hdc_mem, old_bmp);
        DeleteObject(h_bitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(std::ptr::null_mut(), hdc_screen);
        lines
    };
    if scanlines != height {
        return Err("Windows could not read the screenshot pixels.".into());
    }

    // Convert BGRA to RGBA
    for chunk in raw_pixels.chunks_exact_mut(4) {
        let b = chunk[0];
        let r = chunk[2];
        chunk[0] = r;
        chunk[2] = b;
        chunk[3] = 255; // full opacity
    }

    // Encode to PNG in memory
    let img_buffer = image::RgbaImage::from_raw(width as u32, height as u32, raw_pixels)
        .ok_or_else(|| "Failed to construct RGBA image buffer".to_string())?;

    let mut png_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut png_bytes);
    img_buffer
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encoding error: {e}"))?;

    Ok(png_bytes)
}

#[tauri::command]
pub fn capture_screen(
    mode: String,
    x: Option<i32>,
    y: Option<i32>,
    width: Option<i32>,
    height: Option<i32>,
) -> Result<ScreenCaptureResult, String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN,
        };

        let (capture_x, capture_y, capture_w, capture_h) = if mode == "region" {
            (
                x.unwrap_or(0),
                y.unwrap_or(0),
                width.unwrap_or(300).max(10),
                height.unwrap_or(200).max(10),
            )
        } else {
            let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            (vx, vy, vw, vh)
        };

        let png_bytes = capture_gdi_rect(capture_x, capture_y, capture_w, capture_h)?;
        let base64_str = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
        let data_url = format!("data:image/png;base64,{}", base64_str);

        Ok(ScreenCaptureResult {
            data_url,
            width: capture_w as u32,
            height: capture_h as u32,
        })
    }
    #[cfg(not(windows))]
    Err("Screen capture is currently supported on Windows".into())
}

#[tauri::command]
pub fn save_screenshot(
    app: tauri::AppHandle,
    data_url: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    let clean_base64 = if let Some(idx) = data_url.find(',') {
        &data_url[idx + 1..]
    } else {
        &data_url
    };

    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;

    let target_path = if let Some(p) = custom_path {
        PathBuf::from(p)
    } else {
        let folder = crate::recorder::output_dir(&app, "image")?;
        std::fs::create_dir_all(&folder)
            .map_err(|e| format!("Cannot create the screenshot folder: {e}"))?;

        let timestamp = chrono_now_string();
        folder.join(format!("Screenshot_{}.png", timestamp))
    };

    std::fs::write(&target_path, png_bytes).map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(target_path.to_string_lossy().to_string())
}

fn chrono_now_string() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}", now)
}
