# Trade Desk (`/trade`)

Trade Desk is where opportunities become signed transactions.

## Where Opportunities And Adapters Are

### Opportunity stream/list

- Displays categories such as `swap`, `lp`, `lending`, `staking`, and related routes.
- Supports sorting/filtering by yield, risk, confidence, and strategy fit.
- Selecting an item should open its execution workspace.

### Execution workspace

- Shows adapter choices for the selected opportunity.
- Shows privacy mode and gate status.
- Shows simulation controls and execution action.

If adapter metadata exists, you should see explicit route choices.
If not, system falls back to default builder logic.

## Adapter Families You Should Expect

- `ekubo` (swap and LP flows)
- `limit_orders`
- `lending`
- `staking`
- `dca`
- privacy-route variants when policy/flow requires them

## Standard Execution Workflow

1. Select opportunity from the stream.
2. Choose adapter route.
3. Confirm privacy mode and gate state.
4. Simulate.
- Check price impact, fees, and expected output.
- Set slippage explicitly for swap routes.
5. Execute via wallet signature.
6. Capture tx hash/receipt and verify refresh.

## Swap Workflow (Critical)

1. Choose swap opportunity.
2. Set slippage (`0.5%`, `1%`, `2%` or equivalent control).
3. Run simulation first.
4. Execute only if output and impact are acceptable.

## If Something Looks Wrong

- No opportunities:
  check market feed connectivity and refresh state.
- No adapter choices:
  confirm opportunity includes adapter metadata, then check fallback route behavior.
- Simulation succeeds but execution fails:
  check gate mismatch, wallet signing errors, or stale calldata.

Next: [Capital OS](/capital-os) | [How Systems Work](/how-systems-work) | [API Overview](/api-overview)
