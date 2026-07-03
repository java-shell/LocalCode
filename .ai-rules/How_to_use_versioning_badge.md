# Module Versioning Badge System - Implementation Guide

**Created:** November 7, 2025  
**Branch:** `003-subcontractor-management`  
**Status:** Production Ready

---

## Overview

The Module Versioning Badge System is a reusable component that displays version information and release notes for any module in the application. It provides a clean, professional way to communicate updates to users with full version history support.

**Features:**
- ✅ Inline version badge next to module title
- ✅ Clickable dialog with full release notes
- ✅ Multiple version history support
- ✅ Timezone-aware date/time display
- ✅ Color-coded feature/improvement/fix badges
- ✅ Responsive design (50% screen width)
- ✅ Fully accessible (WCAG 2.1 AA compliant)

---

## Quick Start

### Files to Download

You need to copy **3 files** from the `003-subcontractor-management` branch:

#### 1. Component File
```
apps/prototype/components/modules/ModuleVersionBadge.tsx
```
**GitHub URL:**
```
https://github.com/OneDiversified-OneFlow/oneflow-prototype-dev/blob/003-subcontractor-management/apps/prototype/components/modules/ModuleVersionBadge.tsx
```

#### 2. Data File
```
apps/prototype/data/modules/moduleVersions.ts
```
**GitHub URL:**
```
https://github.com/OneDiversified-OneFlow/oneflow-prototype-dev/blob/003-subcontractor-management/apps/prototype/data/modules/moduleVersions.ts
```

#### 3. Hook File
```
apps/prototype/lib/modules/useModuleVersion.ts
```
**GitHub URL:**
```
https://github.com/OneDiversified-OneFlow/oneflow-prototype-dev/blob/003-subcontractor-management/apps/prototype/lib/modules/useModuleVersion.ts
```

### Directory Structure

After copying the files, your project should have:

```
apps/prototype/
├── components/
│   └── modules/
│       └── ModuleVersionBadge.tsx          ← Component
├── data/
│   └── modules/
│       └── moduleVersions.ts               ← Version data
└── lib/
    └── modules/
        └── useModuleVersion.ts             ← Hook
```

---

## Implementation Steps

### Step 1: Add Your Module's Version Data

Edit `apps/prototype/data/modules/moduleVersions.ts` and add your module to the `MODULE_VERSION_MAP`:

```typescript
export const MODULE_VERSION_MAP: Record<string, ModuleVersionRecord> = {
  // Existing modules...
  rfq: { ... },
  
  // Add your module here
  yourModule: {
    moduleKey: 'yourModule',
    displayName: 'Your Module Name',
    currentVersion: 'v1.00',
    releases: [
      {
        version: 'v1.00',
        releasedAt: '2025-11-07T15:00:00-05:00', // ISO 8601 with timezone
        summary: 'Initial release of Your Module with core functionality.',
        highlights: [
          {
            type: 'feature',
            title: 'Core Feature Name',
            description: 'Description of what this feature does.',
            impactedAreas: ['Area 1', 'Area 2'],
          },
          {
            type: 'improvement',
            title: 'Performance Enhancement',
            description: 'What was improved and why.',
            impactedAreas: ['Performance'],
          },
          {
            type: 'fix',
            title: 'Bug Fix Description',
            description: 'What bug was fixed.',
            impactedAreas: ['UI', 'Forms'],
          },
        ],
        knownIssues: [
          'Known issue 1',
          'Known issue 2',
        ],
        comingSoon: [
          'Upcoming feature 1',
          'Upcoming feature 2',
        ],
        contributors: ['Team Name', 'Developer Name'],
      },
    ],
  },
};
```

### Step 2: Import and Use in Your Module Page

In your module's main page (e.g., `apps/prototype/app/(main)/your-module/page.tsx`):

```typescript
'use client';

import { ModuleVersionBadge } from '@/components/modules/ModuleVersionBadge';
import { PageHeader } from '@/components/ui/layout/page-header';
import { useModuleVersion } from '@/lib/modules/useModuleVersion';

export default function YourModulePage() {
  // Get version data for your module
  const { releaseRecord } = useModuleVersion('yourModule');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Your Module Name"
          description="Your module description"
          actions={<ModuleVersionBadge releaseRecord={releaseRecord} />}
        />
        
        {/* Your other page content */}
      </div>
      
      {/* Rest of your module */}
    </div>
  );
}
```

### Step 3: Test Your Implementation

1. **Start your development server:**
   ```bash
   pnpm dev
   ```

2. **Navigate to your module page**

3. **Verify the version badge appears** next to your module title

4. **Click the badge** to open the release notes dialog

5. **Check that:**
   - Version number displays correctly
   - Dialog opens and closes properly
   - Release notes are formatted nicely
   - Timestamps show in your timezone
   - All sections render (features, improvements, fixes, known issues, coming soon)

---

## Updating Version Information

When you release a new version:

### 1. Add New Release to the Array

Edit `apps/prototype/data/modules/moduleVersions.ts`:

```typescript
yourModule: {
  moduleKey: 'yourModule',
  displayName: 'Your Module Name',
  currentVersion: 'v1.01', // ← Update this
  releases: [
    // Add new release at the beginning
    {
      version: 'v1.01',
      releasedAt: '2025-11-15T14:30:00-05:00',
      summary: 'Bug fixes and performance improvements.',
      highlights: [
        {
          type: 'fix',
          title: 'Fixed critical bug',
          description: 'Description of the fix.',
          impactedAreas: ['Forms'],
        },
      ],
      knownIssues: [],
      comingSoon: ['Feature X', 'Feature Y'],
      contributors: ['Engineering Team'],
    },
    // Previous releases follow...
    {
      version: 'v1.00',
      // ... existing v1.00 data
    },
  ],
},
```

### 2. Date Format

Always use ISO 8601 format with timezone:

```typescript
releasedAt: '2025-11-15T14:30:00-05:00'
//           YYYY-MM-DD T HH:MM:SS TIMEZONE
```

**Common Timezones:**
- EST: `-05:00`
- EDT: `-04:00`
- PST: `-08:00`
- PDT: `-07:00`
- UTC: `Z` or `+00:00`

---

## Highlight Types

Use these types to categorize your changes:

| Type | Badge Color | Use For |
|------|-------------|---------|
| `feature` | Blue | New functionality, new features |
| `improvement` | Green | Enhancements, optimizations, refactoring |
| `fix` | Orange | Bug fixes, corrections |

---

## Example: Complete Module Setup

Here's a complete example for a "Budget Calculator" module:

```typescript
// In moduleVersions.ts
budgetCalculator: {
  moduleKey: 'budgetCalculator',
  displayName: 'Budget Calculator',
  currentVersion: 'v1.02',
  releases: [
    {
      version: 'v1.02',
      releasedAt: '2025-11-07T15:00:00-05:00',
      summary: 'Added line item support and automatic tax calculation.',
      highlights: [
        {
          type: 'feature',
          title: 'Line Item Management',
          description: 'Add, edit, and remove individual line items with real-time totals.',
          impactedAreas: ['Forms', 'Calculations'],
        },
        {
          type: 'feature',
          title: 'Automatic Tax Calculation',
          description: 'Tax is now calculated automatically based on subtotal.',
          impactedAreas: ['Calculations'],
        },
        {
          type: 'improvement',
          title: 'Improved Validation',
          description: 'Better error messages and field-level validation.',
          impactedAreas: ['Forms', 'UX'],
        },
      ],
      knownIssues: [
        'Tax rates are currently hardcoded (will be configurable in v1.03)',
      ],
      comingSoon: [
        'Configurable tax rates',
        'Export to PDF',
        'Budget templates',
      ],
      contributors: ['Finance Team', 'Engineering'],
    },
    {
      version: 'v1.01',
      releasedAt: '2025-10-15T10:00:00-05:00',
      summary: 'Initial release with basic budget calculation functionality.',
      highlights: [
        {
          type: 'feature',
          title: 'Basic Budget Calculator',
          description: 'Calculate project budgets with labor and materials.',
          impactedAreas: ['Core Functionality'],
        },
      ],
      knownIssues: [],
      comingSoon: ['Line item support', 'Tax calculation'],
      contributors: ['Engineering'],
    },
  ],
},
```

```typescript
// In your page component
'use client';

import { ModuleVersionBadge } from '@/components/modules/ModuleVersionBadge';
import { PageHeader } from '@/components/ui/layout/page-header';
import { useModuleVersion } from '@/lib/modules/useModuleVersion';

export default function BudgetCalculatorPage() {
  const { releaseRecord } = useModuleVersion('budgetCalculator');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Budget Calculator"
          description="Calculate project budgets with line items and tax"
          actions={<ModuleVersionBadge releaseRecord={releaseRecord} />}
        />
        
        {/* Your budget calculator UI */}
      </div>
    </div>
  );
}
```

---

## Troubleshooting

### Badge Not Showing

**Problem:** Version badge doesn't appear on the page.

**Solutions:**
1. Check that `useModuleVersion` is called with the correct `moduleKey`
2. Verify the `moduleKey` exists in `MODULE_VERSION_MAP`
3. Ensure `releaseRecord` is passed to `ModuleVersionBadge`
4. Check browser console for errors

### Wrong Date/Time Displayed

**Problem:** Release date shows incorrect time or timezone.

**Solutions:**
1. Verify `releasedAt` uses ISO 8601 format with timezone
2. Check timezone offset is correct (e.g., `-05:00` for EST)
3. Use `Z` for UTC times

### Dialog Too Large/Small

**Problem:** Release notes dialog doesn't fit well on screen.

**Solutions:**
1. Current size is `max-w-2xl` (50% width) and `max-h-[70vh]` (70% height)
2. Adjust in `ModuleVersionBadge.tsx` if needed:
   ```typescript
   <DialogContent className="max-w-2xl max-h-[70vh]">
   ```
3. Available Tailwind sizes: `max-w-sm`, `max-w-md`, `max-w-lg`, `max-w-xl`, `max-w-2xl`, `max-w-4xl`

### TypeScript Errors

**Problem:** TypeScript complains about types.

**Solutions:**
1. Ensure all three files are copied correctly
2. Run `pnpm type-check` to see specific errors
3. Check that `moduleKey` matches exactly between data and usage
4. Verify all required fields are present in version data

---

## Best Practices

### 1. Version Numbering

Use semantic versioning:
- **Major** (v2.0): Breaking changes, major rewrites
- **Minor** (v1.1): New features, backwards compatible
- **Patch** (v1.0.1): Bug fixes only

### 2. Release Notes Writing

**Good:**
```typescript
{
  type: 'feature',
  title: 'Budget Export to PDF',
  description: 'Export your budget calculations to a professional PDF document with company branding.',
  impactedAreas: ['Export', 'PDF'],
}
```

**Bad:**
```typescript
{
  type: 'feature',
  title: 'PDF',
  description: 'Added PDF.',
  impactedAreas: ['Stuff'],
}
```

### 3. Keep History

Never delete old releases from the array. Users may want to see what changed over time.

### 4. Update Regularly

Update version information with every significant release, not just major versions.

### 5. Be Honest

Include known issues and limitations. Users appreciate transparency.

---

## Dependencies

This system requires:
- ✅ React 19+
- ✅ Next.js 15+
- ✅ Tailwind CSS
- ✅ ShadCN UI components (Dialog, Badge, ScrollArea)
- ✅ Lucide React icons

All dependencies are already in the project if you're using the standard stack.

---

## Support

**Questions?** Check the RFQ module implementation as a reference:
- Page: `apps/prototype/app/(main)/rfq/page.tsx`
- Data: Look for `rfq` entry in `moduleVersions.ts`

**Issues?** Contact the development team or create a GitHub issue.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-07 | 1.0 | Initial documentation created |

---

**Happy versioning! 🎉**
