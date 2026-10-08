use adham_extensions::domain::activation::{
    ActivationError, ActivationManifest, MAX_HELPER_SKILLS,
};
use adham_extensions::domain::identity::{CanonicalSkillId, SkillSourceKind};
use adham_extensions::domain::skill::{
    InertResourceRef, SkillMetadata, SkillSnapshot, MAX_METADATA_SHORTLIST,
};
use adham_extensions::service::router::{CapabilityRouter, RouterError};

fn create_dummy_skill(name: &str, source: SkillSourceKind) -> SkillSnapshot {
    let metadata =
        SkillMetadata::new(name, format!("Description for {}", name), vec![], None).unwrap();
    let canonical_id = CanonicalSkillId::new(source, "owner-1", name, "rev1");
    SkillSnapshot::new(canonical_id, metadata, "body text", vec![], 1700000000).unwrap()
}

#[test]
fn test_metadata_shortlist_strictly_capped_at_max() {
    let mut snapshots = Vec::new();
    for i in 0..25 {
        snapshots.push(create_dummy_skill(
            &format!("skill-test-{}", i),
            SkillSourceKind::Project,
        ));
    }

    let shortlisted = CapabilityRouter::shortlist_candidates("test", &snapshots);
    // Invariant: shortlisted candidates cannot exceed 20
    assert_eq!(shortlisted.len(), MAX_METADATA_SHORTLIST);
    assert_eq!(shortlisted.len(), 20);
}

#[test]
fn test_helper_skill_limit_enforced() {
    let primary = create_dummy_skill("primary", SkillSourceKind::Project);
    let helper1 = create_dummy_skill("helper-1", SkillSourceKind::Project);
    let helper2 = create_dummy_skill("helper-2", SkillSourceKind::Project);
    let helper3 = create_dummy_skill("helper-3", SkillSourceKind::Project);

    let snapshots = vec![
        primary.clone(),
        helper1.clone(),
        helper2.clone(),
        helper3.clone(),
    ];

    // 2 helpers is legal (limit is 2)
    let legal = CapabilityRouter::create_activation(
        "task-1",
        "step-1",
        primary.canonical_id.clone(),
        vec![helper1.canonical_id.clone(), helper2.canonical_id.clone()],
        &snapshots,
    );
    assert!(legal.is_ok());

    // 3 helpers must fail with HelperLimitExceeded
    let illegal = CapabilityRouter::create_activation(
        "task-1",
        "step-1",
        primary.canonical_id.clone(),
        vec![
            helper1.canonical_id.clone(),
            helper2.canonical_id.clone(),
            helper3.canonical_id.clone(),
        ],
        &snapshots,
    );
    assert!(matches!(
        illegal,
        Err(RouterError::Activation(
            ActivationError::HelperLimitExceeded {
                attempted: 3,
                max: MAX_HELPER_SKILLS
            }
        ))
    ));
}

#[test]
fn test_resource_count_and_byte_budget_enforcement() {
    let primary = create_dummy_skill("primary", SkillSourceKind::Project);
    let mut manifest =
        ActivationManifest::new("task-1", "step-1", primary.canonical_id, vec![], "body").unwrap();

    // Attach 10 resources of 50 KiB each (total 500 KiB < 1 MiB)
    for i in 0..10 {
        let res = InertResourceRef::new(format!("res{}.txt", i), 50 * 1024, "hash").unwrap();
        assert!(manifest.attach_resource(res).is_ok());
    }

    // 11th resource must fail with ResourceCountLimitExceeded
    let res11 = InertResourceRef::new("res11.txt", 1024, "hash").unwrap();
    assert!(matches!(
        manifest.attach_resource(res11),
        Err(ActivationError::ResourceCountLimitExceeded { max: 10 })
    ));

    // Test byte budget limit (exceeding 1 MiB)
    let mut fresh_manifest = ActivationManifest::new(
        "task-2",
        "step-2",
        create_dummy_skill("primary-2", SkillSourceKind::Project).canonical_id,
        vec![],
        "body",
    )
    .unwrap();

    // 5 resources of 250 KiB = 1250 KiB > 1024 KiB
    assert!(fresh_manifest
        .attach_resource(InertResourceRef::new("r1.txt", 250 * 1024, "h1").unwrap())
        .is_ok());
    assert!(fresh_manifest
        .attach_resource(InertResourceRef::new("r2.txt", 250 * 1024, "h2").unwrap())
        .is_ok());
    assert!(fresh_manifest
        .attach_resource(InertResourceRef::new("r3.txt", 250 * 1024, "h3").unwrap())
        .is_ok());
    assert!(fresh_manifest
        .attach_resource(InertResourceRef::new("r4.txt", 250 * 1024, "h4").unwrap())
        .is_ok());

    // 5th pushes over 1024 KiB
    let over =
        fresh_manifest.attach_resource(InertResourceRef::new("r5.txt", 250 * 1024, "h5").unwrap());
    assert!(matches!(
        over,
        Err(ActivationError::ResourceByteLimitExceeded { .. })
    ));
}
