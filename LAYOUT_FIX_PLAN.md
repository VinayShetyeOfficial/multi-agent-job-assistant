# Layout Fix Plan

## Problems Identified:

1. **Hero section scrolls behind execution trace** - Fixed navbar but content isn't positioned properly
2. **Match score block scrolls behind other sections** - Z-index or overflow issues
3. **Agent Reports have too much spacing below each block** - Excessive padding/gaps
4. **Overall layout looks bad** - Need complete redesign

## Solution:

### NEW LAYOUT STRUCTURE:

1. **Fixed Header (h-14)** - Stays at top always
2. **Main Content Area** - Single scrollable container with proper overflow
3. **Input Column (Left 35%)**:
   - Compact hero (small text, no huge py-8)
   - Agent chips inline
   - Resume + JD + Button (tight spacing)
4. **Results Column (Right 65%)**:
   - Match score (smaller, not text-8xl, use text-6xl)
   - Graph topology (compact)
   - Gaps list (compact)
   - Question card (compact)
5. **Bottom Section (Collapsible)**:
   - Trace (collapsed by default)
   - Reports (open by default, tight grid with gap-3 instead of gap-4)

## CSS Changes:

- Remove excessive py-8 padding
- Change space-y-6 to space-y-4
- Change p-8 to p-6 for match score
- Change gap-4 to gap-3 for agent reports
- Add proper overflow handling
- Remove flex-shrink-0 warnings by using shrink-0

## Implementation:

- Rewrite Index() return statement with new compact layout
- Keep all logic intact
- Only change JSX structure and Tailwind classes
