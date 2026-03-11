# OpportunityList Component

Trade Desk opportunity discovery and filtering interface powered by intelligence stream (zkGraph, zkRAG).

## Overview

OpportunityList is a React component that displays filterable, ranked yield opportunities fetched from MarketDataService, with AI-powered recommendations and real-time updates via intelligence stream.

**Key Features:**
- Real-time opportunity fetching with caching
- Advanced filtering (type, yield, risk, privacy mode)
- Multi-sort options (yield, risk, recommendations)
- AI-powered recommendation highlighting
- Search functionality
- Responsive grid layout with Framer Motion animations
- Privacy-aware display with mode indicators
- Error handling and retry logic

## Architecture

### Component Structure

```
OpportunityList
├── FilterBar (Search + Sort + Type/Yield/Risk/Privacy filters)
├── SortControls (Yield | Risk | AI Recommended)
├── OpportunitiesGrid
│   └── OpportunityCard[] (with animations)
├── EmptyState / LoadingState / ErrorState
└── Results info
```

### Data Flow

1. **Mount**: Fetch opportunities from MarketDataService
2. **Optional**: Fetch AI recommendations if autoHighlight is true
3. **Filter**: Apply type, yield, risk, privacy, and search filters
4. **Sort**: Sort by yield (desc), risk (asc), or recommendation confidence (desc)
5. **Display**: Render filtered/sorted opportunities with cards
6. **User Action**: Call onSelectOpportunity when Execute is clicked

### Service Integration

**MarketDataService:**
- `getOpportunities(filters)` - Fetch opportunities with optional filters
- `streamOpportunities()` - Subscribe to real-time updates
- 30-second cache for unfiltered requests

**AIRecommendationService:**
- `getRecommendations(context)` - Fetch AI-powered recommendations
- 60-second cache

## Component Props

```typescript
interface OpportunityListProps {
  onSelectOpportunity: (opportunity: Opportunity) => void;
  autoHighlight?: boolean;                           // Default: true
  maxOpportunities?: number;                         // Default: 20
  defaultFilters?: {
    type?: string[];
    minYield?: number;
    maxRisk?: number;
    privacyMode?: 'public' | 'shielded' | 'dark_ledger';
  };
}
```

### Props Explained

- **onSelectOpportunity**: Callback when user clicks "Execute" on an opportunity
- **autoHighlight**: Enable AI-powered recommendation badges (default: true)
- **maxOpportunities**: Maximum opportunities to display (default: 20)
- **defaultFilters**: Pre-apply filters on mount (optional)

## OpportunityCard Sub-Component

Individual opportunity card displaying:
- Name + description
- Type badge (color-coded: Swap, LP, Lending, Staking, DCA, Limit Orders)
- APY % (currentYield)
- Risk score (0-100, color-coded: green/yellow/red)
- Privacy modes supported (icons: Eye/Lock/Zap)
- TVL (if available)
- AI Recommendation badge (if recommended + autoHighlight)
- Source attribution (zkGraph, zkRAG, Ekubo, Strategy)
- Execute button

### Card Component Props

```typescript
interface OpportunityCardProps {
  opportunity: Opportunity;
  isRecommended: boolean;
  recommendationConfidence?: number;
  onExecute: () => void;
}
```

## Filtering System

### Type Filtering
Filters by opportunity type:
- `swap` - Direct token swaps
- `lp` - Liquidity pool positions
- `lending` - Lending/borrowing pools
- `staking` - Staking opportunities
- `dca` - Dollar-cost averaging
- `limit_orders` - Limit order strategies

### Yield Filtering
- Minimum yield range (0-100%)
- Applied with ≥ operator
- Real-time slider updates

### Risk Filtering
- Maximum risk score (0-100)
- Applied with ≤ operator
- Color-coded ranges:
  - 0-30: Green (low risk)
  - 30-60: Yellow (medium risk)
  - 60-100: Red (high risk)

### Privacy Mode Filtering
- `public` - Transparent opportunities
- `shielded` - Shielded pool access
- `dark_ledger` - Dark Ledger routing
- `all` - No filter (default)

### Search Filtering
Case-insensitive search across:
- Opportunity name
- Opportunity description

## Sorting Options

### Sort by Yield (High to Low)
- Default sort
- Orders by `currentYield` descending
- Shows highest APY opportunities first

### Sort by Risk (Low to High)
- Orders by `riskScore` ascending
- Shows lowest-risk opportunities first

### Sort by AI Recommendation
- Orders by recommendation confidence descending
- Requires autoHighlight = true
- Falls back to yield if no recommendations

## State Management

```typescript
// Opportunities from service
const [opportunities, setOpportunities] = useState<Opportunity[]>([]);

// Filtered and sorted results
const [filteredOpportunities, setFilteredOpportunities] = useState<Opportunity[]>([]);

// AI recommendations
const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

// UI States
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

// Filter states
const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
const [minYield, setMinYield] = useState(0);
const [maxRisk, setMaxRisk] = useState(100);
const [privacyMode, setPrivacyMode] = useState<'all' | 'public' | 'shielded' | 'dark_ledger'>('all');
const [searchQuery, setSearchQuery] = useState('');
const [sortBy, setSortBy] = useState<'yield' | 'risk' | 'recommendation'>('yield');
```

## Styling

### Design System
- **Framework**: Tailwind CSS + Framer Motion
- **Color Palette**:
  - Blue: Primary (select, execute, recommended)
  - Green: Low risk (0-30)
  - Yellow: Medium risk (30-60)
  - Red: High risk (60-100)
  - Gray: Secondary backgrounds and borders
- **Spacing**: 4px/8px/12px/16px/24px base scale
- **Border Radius**: 8px for cards, 6px for buttons

### Animations
- **OpportunityCard**: Fade-in + slide-up on mount (0.3s)
- **Filter Panel**: Height collapse/expand (0.2s)
- **Sort Dropdown**: Hover state with smooth transitions
- **Loading Spinner**: Infinite rotation

### Responsive Design
- **Mobile (< 768px)**: Single-column grid
- **Tablet (768px-1024px)**: 2-column grid
- **Desktop (> 1024px)**: 3-column grid

## Error Handling

### Error States
1. **Fetch Error**: Display error message with "Retry" button
2. **Service Timeout**: Graceful fallback with retry
3. **Empty Results**: Show "No Opportunities Found" with filter reset option

### Retry Logic
- User can click "Retry" button to refetch opportunities
- Clears error state before retry
- Maintains current filters

## Usage Examples

### Basic Usage
```tsx
import { OpportunityList } from '@/components/zkdefi/TradeDesk/OpportunityList';

export function TradeDesk() {
  const handleSelectOpportunity = (opportunity: Opportunity) => {
    console.log('Selected:', opportunity);
    // Open ExecutionPanel
  };

  return (
    <OpportunityList 
      onSelectOpportunity={handleSelectOpportunity}
      autoHighlight={true}
      maxOpportunities={20}
    />
  );
}
```

### With Default Filters
```tsx
<OpportunityList 
  onSelectOpportunity={handleSelectOpportunity}
  defaultFilters={{
    type: ['lending', 'lp'],
    minYield: 5,
    maxRisk: 50,
    privacyMode: 'shielded'
  }}
  maxOpportunities={10}
/>
```

### Minimal Setup (No Recommendations)
```tsx
<OpportunityList 
  onSelectOpportunity={handleSelectOpportunity}
  autoHighlight={false}
/>
```

## Testing

### Test Coverage (66 tests, all passing)

**OpportunityCard Tests** (36 tests):
- Risk color coding (green/yellow/red ranges)
- Type badge styling (all 6 types)
- Privacy mode icons and display
- TVL formatting and display
- Data validation (all required fields)
- Recommendation badge and confidence
- Accessibility (heading hierarchy, button text)

**OpportunityList Tests** (30 tests):
- Type filtering (single, multiple, empty results)
- Yield filtering (min, no matches, all match)
- Risk filtering (max, ranges)
- Privacy mode filtering (all modes)
- Search filtering (name, description, case-insensitive)
- Sorting logic (yield, risk, recommendations)
- Combined filters (type + yield + risk)
- Pagination (maxOpportunities limit)
- Recommendation matching and confidence
- Data validation (types, scores, modes)

### Run Tests
```bash
npm test -- src/components/zkdefi/TradeDesk/__tests__/ --run
```

## Performance Considerations

### Caching
- MarketDataService caches opportunities for 30 seconds
- AIRecommendationService caches recommendations for 60 seconds
- Filters bypass cache (always fresh results)

### Memoization
- OpportunityCard uses React.memo to prevent re-renders
- Service instances are memoized with useMemo
- Callbacks are memoized with useCallback

### Optimization
- Opportunities limited by maxOpportunities prop
- Filter/sort operations happen in-memory (not API calls)
- AnimatePresence on grid for layout animations

## Privacy & Security

### Privacy Modes
- **Public**: Traditional transparent opportunities
- **Shielded**: UTXO privacy via commitment pools
- **Dark Ledger**: Maximum privacy via commitment-based L3 routing

### Data Exposure Model
- No portfolio data exposed to services
- Opportunities are market-level (aggregated)
- User tier is public but not sensitive
- Confidence scores are aggregated from agent

### UI Privacy
- Privacy mode icons clearly labeled
- Source attribution transparent (zkGraph/zkRAG/Ekubo/Strategy)
- Risk scores machine-readable for accessibility

## Integration with Phase 3 Services

### MarketDataService
Provides opportunities without portfolio exposure:
```typescript
const opportunities = await marketDataService.getOpportunities({
  type: 'lending',
  minYield: 5,
  maxRisk: 50,
  privacyMode: 'shielded'
});
```

### AIRecommendationService
Provides recommendations with confidence scores:
```typescript
const recommendations = await aiService.getRecommendations({
  currentPortfolio: {},  // Empty for privacy
  riskProfile: 'moderate',
});
```

### ExecutionPanel (Next Component)
OpportunityList calls onSelectOpportunity which should open ExecutionPanel:
```tsx
const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);

return (
  <>
    <OpportunityList onSelectOpportunity={setSelectedOpportunity} />
    {selectedOpportunity && (
      <ExecutionPanel opportunity={selectedOpportunity} />
    )}
  </>
);
```

## Accessibility

### WCAG Compliance
- Semantic HTML (h3 for opportunity names, buttons for actions)
- ARIA labels on privacy mode icons
- Color not the only indicator (risk has text + color)
- Keyboard navigation support (search input, sort dropdown, filters)

### Screen Reader Support
- Opportunity names as headings
- Descriptive button text ("Execute", not "OK")
- Privacy icons have title attributes
- Source information accessible

### Keyboard Navigation
- Tab through search, sort, filter buttons
- Enter to toggle sort/filter options
- Arrow keys to navigate filter selections
- Space/Enter to execute opportunities

## Browser Support

- **Modern Browsers**: Chrome, Firefox, Safari, Edge (latest 2 versions)
- **React**: 18.0.0+
- **Next.js**: 14.0.0+
- **Tailwind CSS**: 3.3.0+
- **Framer Motion**: 10.16.0+

## Known Limitations

1. **Real-time Updates**: streamOpportunities() currently calls getOpportunities once. Future: implement WebSocket streaming
2. **Max Opportunities**: Pagination not implemented (use maxOpportunities prop to limit results)
3. **Custom Sort**: Only 3 pre-set sort options. Future: allow custom sort by multiple fields
4. **Recommendation Reasons**: Confidence scores shown but not full reasoning text. Future: expand recommendation card with explanation

## Future Enhancements

- [ ] WebSocket streaming for real-time updates
- [ ] Pagination controls for browsing large result sets
- [ ] Custom multi-field sorting
- [ ] Recommendation explanation modal
- [ ] Favorite/bookmark opportunities
- [ ] Historical opportunity performance chart
- [ ] Social features (followers, shared portfolios)
- [ ] A/B testing different recommendation algorithms

## File Structure

```
frontend/src/components/zkdefi/TradeDesk/
├── OpportunityList.tsx           # Main component (418 lines)
├── OpportunityCard.tsx           # Sub-component (206 lines)
└── __tests__/
    ├── OpportunityList.test.tsx  # 30 tests
    └── OpportunityCard.test.tsx  # 36 tests
```

## Commit Message

```
feat(trade-desk): implement OpportunityList with AI-powered recommendations

- Implement OpportunityList component with advanced filtering (type, yield, risk, privacy)
- Create OpportunityCard sub-component with risk color-coding and privacy mode indicators
- Integrate MarketDataService for opportunity fetching with caching
- Integrate AIRecommendationService for AI-powered recommendation highlighting
- Implement multi-sort options (yield, risk, recommendations)
- Add real-time search across opportunity names and descriptions
- Implement comprehensive error handling with retry logic
- Add Framer Motion animations for smooth UX
- Create 66 passing unit tests covering filtering, sorting, and data validation
- Use Tailwind CSS for responsive design (mobile/tablet/desktop)
- Maintain privacy by showing privacy mode indicators (public/shielded/dark_ledger)
```

---

**Location**: `/opt/obsqra.starknet/zkdefi/frontend/src/components/zkdefi/TradeDesk/`

**Status**: ✅ Complete - Ready for integration with ExecutionPanel (Phase 3, Task 3)

**Dependencies**: MarketDataService, AIRecommendationService, Opportunity type, Recommendation type
