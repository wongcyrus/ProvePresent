# SAS URL Regeneration for Seating Plan Photos

## Overview

Student photos in the seating plan are stored in Azure Blob Storage with private access. To view them, we generate fresh SAS (Shared Access Signature) URLs on-demand each time the teacher views the seating plan.

## How It Works

### 1. Storage Configuration
- **Container**: `student-captures` (private, not publicly accessible)
- **Blob naming**: `{sessionId}/{captureRequestId}/{studentId}.jpg`
- **Access**: Requires SAS token for read access

### 2. On-Demand SAS Generation

Every time a teacher views capture results:

```
Teacher clicks "View Results"
    ↓
Frontend calls: GET /api/sessions/{sessionId}/capture/{captureRequestId}/results
    ↓
Backend (getCaptureResults):
    1. Retrieves capture results from database
    2. Queries CAPTURE_UPLOADS table for all student blob URLs
    3. For each blob URL:
       - Calls generateReadSasUrl(blobUrl)
       - Generates fresh SAS token with 1-year expiry
       - Returns SAS URL (blob URL + SAS token)
    4. Returns response with fresh imageUrls map
    ↓
Frontend receives fresh SAS URLs
    ↓
SeatingGridVisualization displays photos using fresh URLs
```

### 3. SAS Token Properties

```typescript
// Generated in backend/src/utils/blobStorage.ts
const sasToken = generateBlobSASQueryParameters({
  containerName: 'student-captures',
  blobName: '{sessionId}/{captureRequestId}/{studentId}.jpg',
  permissions: BlobSASPermissions.parse('r'), // Read-only
  startsOn: new Date(),
  expiresOn: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
}, sharedKeyCredential);
```

**Properties**:
- **Permission**: Read-only (`r`)
- **Expiry**: 1 year from generation time
- **Scope**: Single blob (not container-wide)
- **Security**: Requires storage account key (server-side only)

## Benefits

### 1. Always Fresh URLs
- New SAS tokens generated on each view
- No expired token errors
- No need to refresh or regenerate manually

### 2. Security
- Blobs are private (not publicly accessible)
- SAS tokens are read-only
- Tokens are generated server-side (storage key never exposed)
- Each token is scoped to a single blob

### 3. Long-Term Access
- 1-year expiry allows viewing anytime within the academic year
- Teachers can review historical captures without token expiration
- No need for frequent regeneration

### 4. No Caching Issues
- Frontend doesn't cache SAS URLs
- Each API call gets fresh tokens
- No stale URL problems

## Implementation Details

### Backend: getCaptureResults.ts

```typescript
// Retrieve image URLs for all students with fresh SAS tokens
// Note: SAS URLs are regenerated on each request to ensure they're always valid
const imageUrls: Record<string, string> = {};
const uploadsTable = getTableClient(TableNames.CAPTURE_UPLOADS);

try {
  const uploads = uploadsTable.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${captureRequestId}'`
    }
  });
  
  for await (const upload of uploads) {
    const studentId = upload.rowKey as string;
    const blobUrl = upload.blobUrl as string;
    if (studentId && blobUrl) {
      // Generate fresh read SAS URL with 1-year expiry
      const { generateReadSasUrl } = await import('../utils/blobStorage');
      const sasUrl = generateReadSasUrl(blobUrl);
      imageUrls[studentId] = sasUrl;
    }
  }
  
  context.log(`Generated fresh SAS URLs for ${Object.keys(imageUrls).length} images`);
} catch (error: any) {
  context.warn('Failed to retrieve image URLs:', error);
  // Continue without images - not critical
}
```

### Frontend: CaptureHistory.tsx

```typescript
const fetchCaptureResults = async (captureRequestId: string) => {
  setLoadingResults(true);
  
  try {
    const headers = await getAuthHeaders();
    
    // Fetch fresh results with regenerated SAS URLs
    const response = await fetch(
      `/api/sessions/${sessionId}/capture/${captureRequestId}/results`,
      {
        method: 'GET',
        headers
      }
    );
    
    const data: GetCaptureResultsResponse = await response.json();
    setCaptureResults(data); // Contains fresh imageUrls
    setSelectedCapture(captureRequestId);
  } catch (err: any) {
    // Handle error
  }
};
```

### Frontend: SeatingGridVisualization.tsx

```typescript
// Receives fresh imageUrls from parent component
<SeatingGridVisualization 
  positions={captureResults.positions} 
  imageUrls={captureResults.imageUrls ? 
    new Map(Object.entries(captureResults.imageUrls)) : 
    undefined
  }
/>
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Teacher Views Seating Plan                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Frontend: GET /api/.../capture/{id}/results                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend: getCaptureResults()                                 │
│  1. Authenticate teacher                                     │
│  2. Verify session ownership                                 │
│  3. Retrieve capture request                                 │
│  4. Query CAPTURE_UPLOADS table                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ For each uploaded image:                                     │
│  1. Get blob URL from database                               │
│  2. Call generateReadSasUrl(blobUrl)                         │
│  3. Generate fresh SAS token (1-year expiry)                 │
│  4. Append SAS token to blob URL                             │
│  5. Add to imageUrls map                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Return response with:                                        │
│  - positions: SeatingPosition[]                              │
│  - imageUrls: { studentId: sasUrl }                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Frontend: Display photos in seating grid                     │
│  - Thumbnail in grid cell                                    │
│  - Larger photo in popup                                     │
│  - Full-screen on click                                      │
└─────────────────────────────────────────────────────────────┘
```

## Performance Considerations

### SAS Generation Cost
- **Time**: ~1-2ms per SAS URL generation
- **For 30 students**: ~30-60ms total
- **Negligible impact** on API response time

### Network
- SAS URLs are ~200-300 bytes each
- For 30 students: ~6-9KB additional response size
- **Minimal bandwidth impact**

### Caching
- **No caching** of SAS URLs in frontend
- **No caching** of API responses (Cache-Control: no-cache)
- Ensures fresh tokens on every view

## Security Considerations

### Why Not Public Blobs?
- Student photos contain personal information
- Privacy regulations (GDPR, FERPA) require access control
- SAS tokens provide auditable, time-limited access

### Why 1-Year Expiry?
- Balances convenience with security
- Covers full academic year
- Long enough to avoid frequent regeneration
- Short enough to limit exposure if token leaks

### Token Scope
- Each SAS token is scoped to a single blob
- Cannot access other students' photos with one token
- Cannot write or delete (read-only permission)

## Troubleshooting

### Issue: 403 Forbidden on image load
**Cause**: SAS token expired or invalid  
**Solution**: Refresh the page to get new SAS URLs

### Issue: Images not loading
**Cause**: CORS not configured on blob storage  
**Solution**: Run `./configure-storage-cors.sh` to set CORS policy

### Issue: Slow image loading
**Cause**: Large image files or network latency  
**Solution**: Consider image optimization or CDN

## Monitoring

### Metrics to Track
- SAS URL generation time
- Number of images per capture
- API response time for getCaptureResults
- Image load failures (403/404 errors)

### Logs
```
Generated fresh SAS URLs for 25 images
```

Look for this log message to confirm SAS generation is working.

## Future Enhancements

### 1. SAS URL Caching (Optional)
Cache SAS URLs in frontend for 1 hour to reduce API calls:
```typescript
const cachedUrls = localStorage.getItem(`sas-${captureRequestId}`);
if (cachedUrls && !isExpired(cachedUrls)) {
  return JSON.parse(cachedUrls);
}
```

### 2. Lazy Loading
Generate SAS URLs only for visible images:
```typescript
// Generate SAS URL when image enters viewport
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      generateSasUrl(entry.target);
    }
  });
});
```

### 3. CDN Integration
Serve images through Azure CDN for better performance:
- Cache images at edge locations
- Reduce latency for global users
- Lower blob storage egress costs

## Summary

The current implementation generates fresh SAS URLs on-demand each time the teacher views the seating plan. This ensures:

✅ **Always valid URLs** - No expiration errors  
✅ **Secure access** - Private blobs with read-only tokens  
✅ **Long-term viewing** - 1-year expiry covers academic year  
✅ **No caching issues** - Fresh tokens on every request  
✅ **Simple implementation** - No complex token management  

The system is production-ready and provides a good balance between security, convenience, and performance.
