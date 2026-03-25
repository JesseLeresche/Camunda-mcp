# BPMN Modeling Best Practices

Guidelines for producing clean, readable BPMN diagrams using the Camunda MCP Plugin.

---

## Element Placement

### Coordinate Systems

bpmn-js uses different coordinate interpretations depending on element type:

| Element Type | `(x, y)` refers to | Standard Size |
|---|---|---|
| Start/End Events | Center | 36x36 |
| Intermediate/Boundary Events | Center | 36x36 |
| Gateways | Center | 50x50 |
| Tasks (User, Service, etc.) | **Top-left corner** | 100x80 |
| Sub-processes | Top-left corner | Variable |

To center-align a task with an event at target center Y:
- Events/Gateways: `y = targetCenterY`
- Tasks: `y = targetCenterY - 40` (half of 80px height)

### Spacing

- **Horizontal gap between elements:** 160–200px (center to center)
- **Vertical gap for parallel branches:** 120px above/below the center line
- **Rejection/error paths:** 180px below the main flow
- **Annotations:** 100–130px above the element they annotate

### Standard Layout

```
Main flow: single horizontal center line (e.g., Y=240)

[Start] —→ [Task] —→ [Gateway] —→ [Task] —→ [End]
  x=180     x=370      x=540      x=720     x=900
  y=240     y=200      y=240      y=200     y=240
            (top-left)            (top-left)
```

---

## Flow Routing

### Place First, Connect Second

**Always** place all elements at their final positions before creating any connections. bpmn-js generates connection waypoints based on element positions at the time of connection. Moving elements after connecting does NOT re-route the flow lines.

### Fixing Layout After the Fact

If flow lines need fixing after connections are made:

1. Export the diagram via `get_diagram_xml`
2. Edit the `<bpmndi:BPMNEdge>` waypoints in the XML
3. Reimport via `import_xml`

Do **not** use `move_element` to fix layout — it moves the shape but leaves waypoints stale.

### Waypoint Patterns

**Straight horizontal flow** (same Y):
```xml
<di:waypoint x="420" y="240" />
<di:waypoint x="500" y="240" />
```

**Gateway branch going up** (from gateway top to element above):
```xml
<di:waypoint x="540" y="215" />  <!-- gateway top -->
<di:waypoint x="540" y="120" />  <!-- straight up -->
<di:waypoint x="700" y="120" />  <!-- across to element -->
```

**Gateway branch going down** (from gateway bottom):
```xml
<di:waypoint x="540" y="265" />  <!-- gateway bottom -->
<di:waypoint x="540" y="400" />  <!-- straight down -->
<di:waypoint x="700" y="400" />  <!-- across to element -->
```

**Rework/retry loop** (route below the elements):
```xml
<di:waypoint x="900" y="265" />  <!-- source bottom -->
<di:waypoint x="900" y="310" />  <!-- down -->
<di:waypoint x="700" y="310" />  <!-- left below -->
<di:waypoint x="700" y="280" />  <!-- up to target -->
```

---

## Gateway Patterns

### Exclusive (XOR) — Decision Point

- Place on the center line
- Label outgoing flows with conditions ("Approved", "Rejected")
- Happy path continues on the center line
- Exception path branches above or below

### Parallel (AND) — Split/Join

- Split and join gateways on the center line at the same Y
- Fan out to streams: upper (Y-120), center (Y), lower (Y+120)
- All stream tasks at the same X coordinate (vertically stacked)
- Mirror the fan-in pattern at the join

```
                    [Task A]  (Y-120)
                   ↗         ↘
[+] Split ——→ [Task B]  (Y)    ——→ [+] Join
                   ↘         ↗
                    [Task C]  (Y+120)
```

### Conditional Branch That Rejoins

- Place the "detour" task above the main flow, horizontally between split and rejoin
- Flow: gateway → UP → detour → RIGHT and DOWN → rejoin
- Straight-through path stays on center line

```
              [Full KYC]  (above, between gateways)
             ↗            ↘
[X] Split ——————————————→ [+] Continue
       "Existing Client"
```

---

## Labeling

- **Gateway outgoing flows:** Always label with the condition (use `set_properties` with `name` on the flow ID)
- **Tasks:** Use concise 2-line names with `\n` for line breaks (e.g., `"Capture Client\nInformation"`)
- **Start/End events:** Name the business event, not the technical action (e.g., "Order Received" not "Start Process")
- **Annotations:** Use for system names, technology references, or SLA information

---

## Process Structure

### Happy Path First

Design the main success path as a straight horizontal line. Add exception handling, error paths, and loops as branches off this line.

### Rejection/Error Paths

- Branch downward from the decision gateway
- Keep rejection tasks directly below the gateway (same X)
- End with a terminate or error end event

### Swim Lanes (Collaboration Diagrams)

- Use `add_participant` for each organizational unit
- Place tasks inside the appropriate lane
- Use `add_message_flow` for cross-pool communication (dashed lines)

---

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Start Event | Business trigger | "Order Received", "Client Identified" |
| End Event | Business outcome | "Order Fulfilled", "Onboarding Rejected" |
| User Task | Verb + Object | "Review Order", "Capture Client Information" |
| Service Task | Verb + Object | "Process Payment", "Store Documents" |
| Gateway | Question format | "Approved?", "KYC Passed?", "New or Existing?" |
| Sequence Flow | Condition answer | "Yes", "No", "Approved", "Rejected" |

---

*This document is maintained alongside the Camunda MCP Plugin. When layout improvements or new patterns are discovered, they should be added here.*
