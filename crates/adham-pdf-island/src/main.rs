//! Island binary entry: runs the synthetic worker v0 and exits with a
//! protocol exit code the supervisor maps to a refusal.
mod caps;
#[allow(dead_code)] // the bin shares the lib's protocol module but uses only its exit codes
mod protocol;
mod worker;

fn main() {
    let code = worker::run_worker();
    std::process::exit(code);
}
