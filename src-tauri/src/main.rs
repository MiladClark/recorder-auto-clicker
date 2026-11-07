// Keep release builds in the Windows GUI subsystem so launching the app does not open a console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    framecue_lib::run();
}
