// GUI subsystem in every build, including CI test builds, so no console window opens.
#![windows_subsystem = "windows"]

fn main() {
    nexonic_trace_lib::run();
}
