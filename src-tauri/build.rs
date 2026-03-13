fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=proto/secs/rpc/v1/secs_rpc.proto");

    tonic_prost_build::configure()
        .build_server(false)
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .type_attribute(".", "#[serde(rename_all = \"camelCase\")]")
        .message_attribute(".", "#[serde(default)]")
        .compile_protos(&["proto/secs/rpc/v1/secs_rpc.proto"], &["proto"])?;

    tauri_build::build();
    Ok(())
}
