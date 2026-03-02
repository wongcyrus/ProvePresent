# Seating Plan Photo Enhancement

## Overview

Enhanced the teacher seating plan display to show student photos with click-to-enlarge functionality.

## Features Implemented

### 1. Photo Thumbnails in Grid Cells
- Small circular photo thumbnails (50px) displayed in each occupied grid cell
- Falls back to user icon (👤) if no photo available
- Photos have white border and subtle shadow for better visibility

### 2. Photo in Detail Popup
- When clicking a grid cell, popup shows larger photo (200px × 200px)
- Photo has colored border matching confidence level
- Hover effect with scale animation
- "Click image to enlarge" hint text

### 3. Full-Screen Enlarged View
- Click photo in popup to view full-screen enlarged version
- Dark backdrop (90% opacity) for better focus
- Photo scales to fit screen (max 90vw × 90vh)
- Close button in top-right corner
- Click anywhere to close
- Hint text at bottom: "Click anywhere to close"

## Technical Implementation

### Backend Changes

#### 1. Type Definition (`backend/src/types/studentImageCapture.ts`)
```typescript
export interface GetCaptureResultsResponse {
  captureRequestId: string;
  status: CaptureRequestStatus;
  uploadedCount: number;
  totalCount: number;
  positions?: SeatingPosition[];
  imageUrls?: Record<string, string>; // NEW: Map of studentId to SAS URL
  analysisNotes?: string;
  analyzedAt?: string;
  errorMessage?: string;
}
```

#### 2. API Endpoint (`backend/src/functions/getCaptureResults.ts`)
- Retrieves image URLs from CAPTURE_UPLOADS table
- **Generates read SAS URLs with 1-year expiry** for each image
- Includes `imageUrls` in response for COMPLETED captures
- Maps studentId to SAS URL (not plain blob URL)
- Gracefully handles missing images (non-critical)

```typescript
// Retrieve image URLs for all students
const imageUrls: Record<string, string> = {};
const uploadsTable = getTableClient(TableNames.CAPTURE_UPLOADS);

const uploads = uploadsTable.listEntities({
  queryOptions: {
    filter: `PartitionKey eq '${captureRequestId}'`
  }
});

for await (const upload of uploads) {
  const studentId = upload.rowKey as string;
  const blobUrl = upload.blobUrl as string;
  if (studentId && blobUrl) {
    // Generate read SAS URL with 1-year expiry for long-term viewing
    const { generateReadSasUrl } = await import('../utils/blobStorage');
    const sasUrl = generateReadSasUrl(blobUrl);
    imageUrls[studentId] = sasUrl;
  }
}
```

#### 3. SAS URL Generation (`backend/src/utils/blobStorage.ts`)
- Updated `generateReadSasUrl()` to use **1-year expiry** for long-term viewing
- Teachers can view photos anytime without SAS token expiration
- Still read-only permissions for security

```typescript
// Generate SAS token with read-only permissions and 1-year expiry
const sasToken = generateBlobSASQueryParameters(
  {
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse('r'), // Read only
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 365 days
  },
  sharedKeyCredential
).toString();
```

### Frontend Changes

#### 1. Component Props (`frontend/src/components/SeatingGridVisualization.tsx`)
```typescript
interface SeatingGridVisualizationProps {
  positions: SeatingPosition[];
  imageUrls?: Map<string, string>; // Optional map of studentId to image URL
}
```

#### 2. State Management
```typescript
const [selectedPosition, setSelectedPosition] = useState<SelectedPosition | null>(null);
const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
```

#### 3. Grid Cell Rendering
- Shows circular photo thumbnail if available
- Falls back to icon if no photo
- Photo has proper styling (border, shadow, object-fit: cover)

#### 4. Detail Popup
- Shows 200px × 200px photo with confidence-colored border
- Hover effect scales to 105%
- Click handler to enlarge image
- Hint text below photo

#### 5. Enlarged Image Modal
- Full-screen overlay with dark backdrop
- Photo scales to fit screen
- Close button and click-anywhere-to-close
- Prevents event propagation on image click

#### 6. Usage in Components

**CaptureHistory.tsx:**
```typescript
<SeatingGridVisualization 
  positions={captureResults.positions} 
  imageUrls={captureResults.imageUrls ? 
    new Map(Object.entries(captureResults.imageUrls)) : 
    undefined
  }
/>
```

**TeacherCaptureControl.tsx:**
```typescript
<SeatingGridVisualization 
  positions={results} 
  imageUrls={undefined} // No images from SignalR events yet
/>
```

## User Experience

### Grid View
1. Teacher sees seating grid with student photos
2. Photos are small thumbnails in circular frames
3. Confidence level shown by colored borders

### Detail View
1. Click any occupied cell to see details
2. Popup shows larger photo (if available)
3. Student info, position, confidence, and reasoning displayed

### Enlarged View
1. Click photo in popup to enlarge
2. Full-screen view with dark backdrop
3. Photo scales to fit screen
4. Easy to close (click anywhere or close button)

## Benefits

1. **Visual Recognition**: Teachers can quickly identify students by photo
2. **Better Context**: Photos provide context for position estimates
3. **Verification**: Teachers can verify GPT's analysis by seeing actual photos
4. **User-Friendly**: Intuitive click-to-enlarge interaction
5. **Graceful Degradation**: Works without photos (shows icons instead)

## Future Enhancements

1. **SignalR Events**: Include image URLs in real-time completion events
2. **Lazy Loading**: Load images on-demand for better performance
3. **Image Caching**: Cache images in browser for faster subsequent views
4. **Zoom Controls**: Add zoom in/out controls in enlarged view
5. **Gallery Mode**: Navigate between student photos in enlarged view
6. **Download Option**: Allow teachers to download seating plan with photos

## Testing

### Manual Testing Steps

1. **Start a capture session** with 10+ students
2. **Students upload photos** during capture window
3. **Wait for analysis** to complete
4. **View Capture History**:
   - Grid should show photo thumbnails
   - Click cell to see popup with larger photo
   - Click photo to enlarge full-screen
   - Verify close functionality works
5. **Test without photos**:
   - Should show user icons instead
   - No errors or broken images

### Edge Cases Handled

- No photos available (shows icons)
- Missing image URLs (graceful fallback)
- Large images (scales to fit screen)
- Small images (maintains aspect ratio)
- Network errors (non-critical, continues without images)

## Deployment

No infrastructure changes required. Just deploy updated code:

```bash
# Backend
cd backend
npm run build
npm run deploy

# Frontend
cd frontend
npm run build
# Deploy static files to Azure Static Web Apps
```

## Files Modified

### Backend
- `backend/src/types/studentImageCapture.ts` - Added imageUrls to response type
- `backend/src/functions/getCaptureResults.ts` - Retrieve and include image URLs

### Frontend
- `frontend/src/components/SeatingGridVisualization.tsx` - Added photo display and enlarge functionality
- `frontend/src/components/CaptureHistory.tsx` - Pass image URLs to grid component
- `frontend/src/components/TeacherCaptureControl.tsx` - Updated to pass imageUrls prop

## Summary

The seating plan now displays student photos with an intuitive click-to-enlarge interface, making it easier for teachers to visually verify student positions and recognize students in the classroom layout.
