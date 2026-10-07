use adham_core_types::ContentId;
use adham_runtime::domain::*;

#[test]
fn test_inbox_item_prioritization_and_disposition() {
    let mut items = vec![
        InboxItem::new(
            InboxItemId::new_v7(),
            InboxItemType::FollowUp,
            ContentId::new_v7(),
            None,
            1,
        ),
        InboxItem::new(
            InboxItemId::new_v7(),
            InboxItemType::Steering,
            ContentId::new_v7(),
            None,
            2,
        ),
        InboxItem::new(
            InboxItemId::new_v7(),
            InboxItemType::Objective,
            ContentId::new_v7(),
            None,
            3,
        ),
    ];

    // Verify initial dispositions are Queued
    for item in &items {
        assert_eq!(item.disposition, InboxDisposition::Queued);
    }

    // Sort by priority (Steering first, then Objective, then FollowUp, then FIFO position)
    items.sort_by(|a, b| {
        a.item_type
            .cmp(&b.item_type)
            .then(a.enqueue_position.cmp(&b.enqueue_position))
    });

    assert_eq!(items[0].item_type, InboxItemType::Steering);
    assert_eq!(items[1].item_type, InboxItemType::Objective);
    assert_eq!(items[2].item_type, InboxItemType::FollowUp);

    // Claim the steering item
    items[0].disposition = InboxDisposition::Claimed;
    assert_eq!(items[0].disposition, InboxDisposition::Claimed);
}
