use adham_extensions::domain::package::AGENT_PLUGINS_SCHEMA_V1;
use adham_extensions::service::plugin_validator::{PluginValidationError, PluginValidator};

#[test]
fn test_agent_plugins_conformance_and_unknown_fields_handling() {
    let manifest_json = format!(
        r#"{{
            "$schema": "{}",
            "name": "git-tools",
            "version": "1.2.0",
            "description": "Git automation and inspection tools",
            "skills": "skills",
            "mcp": "mcp.json",
            "future_spec_field": "some_value",
            "custom_metadata": {{ "rating": 5 }}
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );

    let manifest = PluginValidator::validate_manifest(&manifest_json)
        .expect("Valid manifest should parse cleanly");

    assert_eq!(manifest.name, "git-tools");
    assert_eq!(manifest.version.unwrap().0, "1.2.0");
    assert_eq!(
        manifest.description.as_deref(),
        Some("Git automation and inspection tools")
    );
    assert_eq!(manifest.skills_dir.as_deref(), Some("skills"));
    assert_eq!(manifest.mcp_config.as_deref(), Some("mcp.json"));

    // Invariant: Nonfatal unknown fields are safely captured and ignored without elevating authority
    assert_eq!(manifest.unknown_fields.len(), 2);
    assert!(manifest.unknown_fields.contains_key("future_spec_field"));
    assert!(manifest.unknown_fields.contains_key("custom_metadata"));
}

#[test]
fn test_invalid_schema_and_name_rejection() {
    // Missing $schema
    let missing_schema = r#"{"name": "git-tools"}"#;
    let res1 = PluginValidator::validate_manifest(missing_schema);
    assert!(matches!(
        res1,
        Err(PluginValidationError::InvalidSchema { .. })
    ));

    // Unsupported schema version
    let wrong_schema = r#"{
        "$schema": "https://agent-plugins.org/schemas/0.9.0/plugin.schema.json",
        "name": "git-tools"
    }"#;
    let res2 = PluginValidator::validate_manifest(wrong_schema);
    assert!(matches!(
        res2,
        Err(PluginValidationError::InvalidSchema { .. })
    ));

    // Empty or path-traversal name
    let bad_name = format!(
        r#"{{
            "$schema": "{}",
            "name": "../escape"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );
    let res3 = PluginValidator::validate_manifest(&bad_name);
    assert!(matches!(res3, Err(PluginValidationError::InvalidName)));
}

#[test]
fn test_path_containment_violation_in_manifest() {
    let traversal_skills = format!(
        r#"{{
            "$schema": "{}",
            "name": "escape-plugin",
            "skills": "../../../shared/skills"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );
    let res = PluginValidator::validate_manifest(&traversal_skills);
    assert!(matches!(
        res,
        Err(PluginValidationError::PathContainmentViolation { .. })
    ));
}
