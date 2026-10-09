SELECT turn_id, item_id, rollout_ordinal, item_json, turn_rollout_ordinal
FROM (
    SELECT
        items.turn_id,
        items.item_id,
        items.rollout_ordinal,
        items.item_json,
        turns.rollout_ordinal AS turn_rollout_ordinal
    FROM thread_items AS items
    JOIN thread_turns AS turns
      ON turns.thread_id = items.thread_id
     AND turns.turn_id = items.turn_id
    WHERE items.thread_id = ?
      AND (
          items.item_type = 'userMessage'
          OR (
              items.item_type = 'agentMessage'
              AND json_extract(items.item_json, '$.phase') = 'partial_answer'
          )
      )
      AND items.rollout_ordinal >= ?
      AND items.rollout_ordinal < ?
      AND turns.rollout_ordinal >= ?
      AND turns.rollout_ordinal < ?

    UNION ALL

    SELECT
        items.turn_id,
        items.item_id,
        items.rollout_ordinal,
        items.item_json,
        turns.rollout_ordinal AS turn_rollout_ordinal
    FROM thread_turns AS turns
    JOIN thread_items AS items
      ON items.thread_id = turns.thread_id
     AND items.turn_id = turns.turn_id
     AND items.item_id = turns.final_agent_item_id
    WHERE turns.thread_id = ?
      AND turns.final_agent_item_id IS NOT NULL
      AND items.rollout_ordinal >= ?
      AND items.rollout_ordinal < ?
      AND turns.rollout_ordinal >= ?
      AND turns.rollout_ordinal < ?
)
ORDER BY rollout_ordinal ASC
