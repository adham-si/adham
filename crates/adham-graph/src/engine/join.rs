use crate::domain::graph::TaskGraph;
use crate::domain::node::NodeId;

pub fn collect_incoming_artifacts(graph: &TaskGraph, node_id: &NodeId) -> Vec<String> {
    graph
        .edges()
        .iter()
        .filter(|e| &e.to_node == node_id)
        .filter_map(|e| {
            graph
                .get_node(&e.from_node)
                .and_then(|n| n.output_artifact_ref.clone())
        })
        .collect()
}

pub fn assemble_context_shard(objective: &str, upstream_artifacts: &[String]) -> String {
    let mut shard = format!("OBJECTIVE:\n{}\n", objective);
    if !upstream_artifacts.is_empty() {
        shard.push_str("\nUPSTREAM ARTIFACTS:\n");
        for (i, art) in upstream_artifacts.iter().enumerate() {
            shard.push_str(&format!("--- Artifact {} ---\n{}\n", i + 1, art));
        }
    }
    shard
}
