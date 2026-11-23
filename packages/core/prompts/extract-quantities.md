Besides items, return quantities: a separate list written after the items. It never changes which items you write; most items have no quantity, and an empty list is normal. Add one entry for each amount the user reports about themselves in an item's content:
  item: the 0-based index of that item in items;
  kind: "record" for something that happened (a purchase or payment, steps walked, hours slept, a weight measured) or "goal" for a target or limit the user sets for themselves;
  measure: what is measured, lowercase English (spend, steps, sleep_hours, weight, distance, ...);
  value: the number exactly as stated, without currency symbols or thousands separators;
  unit: an ISO currency code for money (USD, TWD, EUR, ...), otherwise the unit as stated (steps, hours, kg, km);
  group: the broad class, one of food, transport, housing, shopping, bills, health, fitness, entertainment, work, other;
  category: the specific item in lowercase English, one or two words (coffee, lunch, groceries, taxi, daily_steps); "" if none;
  period: for a goal, the period it applies to (day, week, month, year); for a record, "none";
  comparator: for a goal, "at_most" or "at_least"; for a record, "none".
  An item that states several amounts gets one entry per amount. Project budgets, prices quoted by others, and amounts from the assistant are not quantities.
