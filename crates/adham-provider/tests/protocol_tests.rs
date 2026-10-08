use adham_provider::adapters::ollama::OllamaStreamParser;
use adham_provider::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};

#[test]
fn test_ollama_ndjson_stream_parsing() {
    let chunk1 =
        r#"{"model":"llama3.2","message":{"role":"assistant","content":"Hello "},"done":false}"#;
    let chunk2 =
        r#"{"model":"llama3.2","message":{"role":"assistant","content":"world!"},"done":false}"#;
    let chunk3 = r#"{"model":"llama3.2","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":10,"eval_count":5}"#;

    let events1 = OllamaStreamParser::parse_line(chunk1).expect("parse chunk 1");
    assert_eq!(
        events1,
        vec![NormalizedStreamEvent::TextDelta("Hello ".to_string())]
    );

    let events2 = OllamaStreamParser::parse_line(chunk2).expect("parse chunk 2");
    assert_eq!(
        events2,
        vec![NormalizedStreamEvent::TextDelta("world!".to_string())]
    );

    let events3 = OllamaStreamParser::parse_line(chunk3).expect("parse chunk 3");
    assert_eq!(
        events3,
        vec![
            NormalizedStreamEvent::Progress(StreamUsage {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            }),
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ]
    );
}

#[test]
fn test_ollama_invalid_ndjson_rejection() {
    let malformed = "this is not valid json";
    let res = OllamaStreamParser::parse_line(malformed);
    assert!(res.is_err());
}
