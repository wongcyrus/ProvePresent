/**
 * External Teachers Management API
 * Allows admins to add/remove external teachers who can use the system
 * 
 * Table Schema (ExternalTeachers):
 * - PartitionKey: 'TEACHER'
 * - RowKey: email (lowercase)
 * - email: string (original case preserved)
 * - addedBy: string (admin email who added)
 * - addedAt: string (ISO timestamp)
 * - name: string (optional display name)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { parseAuthFromRequest, hasRoleAsync, getUserId, clearExternalTeachersCache } from '../utils/auth';
import { getTableClient, TableNames } from '../utils/database';

interface AddExternalTeacherRequest {
  email: string;
  name?: string;
}

/**
 * List all external teachers
 * GET /api/admin/external-teachers
 */
export async function listExternalTeachers(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing GET /api/admin/external-teachers request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }
    // Require Teacher role (only teachers can view external teachers list)
    if (!await hasRoleAsync(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const table = getTableClient(TableNames.EXTERNAL_TEACHERS);
    const teachers: Array<{ email: string; name?: string; addedBy: string; addedAt: string }> = [];

    try {
      for await (const entity of table.listEntities()) {
        teachers.push({
          email: entity.email as string,
          name: entity.name as string | undefined,
          addedBy: entity.addedBy as string,
          addedAt: entity.addedAt as string
        });
      }
    } catch (error: any) {
      // Table might not exist yet
      if (error.statusCode === 404) {
        return { status: 200, jsonBody: { teachers: [] } };
      }
      throw error;
    }

    return {
      status: 200,
      jsonBody: { teachers }
    };

  } catch (error: any) {
    context.error('Error listing external teachers:', error);
    return {
      status: 500,
      jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'Failed to list external teachers', timestamp: Date.now() } }
    };
  }
}

/**
 * Add an external teacher
 * POST /api/admin/external-teachers
 */
export async function addExternalTeacher(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing POST /api/admin/external-teachers request');

  try {
    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    const adminId = getUserId(principal);

    // Require Teacher role (only existing teachers can add external teachers)
    if (!await hasRoleAsync(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    // Parse request body
    const body = await request.json() as AddExternalTeacherRequest;
    if (!body.email) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'email is required', timestamp: Date.now() } }
      };
    }

    const email = body.email.trim();
    const emailLower = email.toLowerCase();

    // Validate email format
    if (!email.includes('@') || email.length < 5) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Invalid email format', timestamp: Date.now() } }
      };
    }

    // Don't allow VTC emails (they're already handled by domain logic)
    if (emailLower.endsWith('@vtc.edu.hk') || emailLower.endsWith('@stu.vtc.edu.hk')) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'VTC emails are automatically assigned roles', timestamp: Date.now() } }
      };
    }

    const table = getTableClient(TableNames.EXTERNAL_TEACHERS);

    // Check if already exists
    try {
      await table.getEntity('TEACHER', emailLower);
      return {
        status: 409,
        jsonBody: { error: { code: 'ALREADY_EXISTS', message: 'External teacher already exists', timestamp: Date.now() } }
      };
    } catch (error: any) {
      if (error.statusCode !== 404) throw error;
      // 404 is expected - teacher doesn't exist yet
    }

    // Add external teacher
    await table.createEntity({
      partitionKey: 'TEACHER',
      rowKey: emailLower,
      email: email,
      name: body.name || '',
      addedBy: adminId,
      addedAt: new Date().toISOString()
    });

    // Clear cache so the new teacher is recognized immediately
    clearExternalTeachersCache();

    context.log(`External teacher ${email} added by ${adminId}`);

    return {
      status: 201,
      jsonBody: {
        message: 'External teacher added successfully',
        email: email,
        name: body.name || null
      }
    };

  } catch (error: any) {
    context.error('Error adding external teacher:', error);
    return {
      status: 500,
      jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'Failed to add external teacher', timestamp: Date.now() } }
    };
  }
}

/**
 * Remove an external teacher
 * DELETE /api/admin/external-teachers/{email}
 */
export async function removeExternalTeacher(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('Processing DELETE /api/admin/external-teachers/{email} request');

  try {
    const email = request.params.email;
    if (!email) {
      return {
        status: 400,
        jsonBody: { error: { code: 'INVALID_REQUEST', message: 'Email parameter is required', timestamp: Date.now() } }
      };
    }

    // Parse authentication
    const principal = parseAuthFromRequest(request);
    if (!principal) {
      return {
        status: 401,
        jsonBody: { error: { code: 'UNAUTHORIZED', message: 'Missing authentication header', timestamp: Date.now() } }
      };
    }    const adminId = getUserId(principal);

    // Require Teacher role
    if (!await hasRoleAsync(principal, 'teacher')) {
      return {
        status: 403,
        jsonBody: { error: { code: 'FORBIDDEN', message: 'Teacher role required', timestamp: Date.now() } }
      };
    }

    const emailLower = decodeURIComponent(email).toLowerCase();
    const table = getTableClient(TableNames.EXTERNAL_TEACHERS);

    // Delete the external teacher
    try {
      await table.deleteEntity('TEACHER', emailLower);
    } catch (error: any) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          jsonBody: { error: { code: 'NOT_FOUND', message: 'External teacher not found', timestamp: Date.now() } }
        };
      }
      throw error;
    }

    // Clear cache
    clearExternalTeachersCache();

    context.log(`External teacher ${emailLower} removed by ${adminId}`);

    return {
      status: 200,
      jsonBody: { message: 'External teacher removed successfully', email: emailLower }
    };

  } catch (error: any) {
    context.error('Error removing external teacher:', error);
    return {
      status: 500,
      jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'Failed to remove external teacher', timestamp: Date.now() } }
    };
  }
}

// Register HTTP endpoints
app.http('listExternalTeachers', {
  methods: ['GET'],
  route: 'admin/external-teachers',
  authLevel: 'anonymous',
  handler: listExternalTeachers
});

app.http('addExternalTeacher', {
  methods: ['POST'],
  route: 'admin/external-teachers',
  authLevel: 'anonymous',
  handler: addExternalTeacher
});

app.http('removeExternalTeacher', {
  methods: ['DELETE'],
  route: 'admin/external-teachers/{email}',
  authLevel: 'anonymous',
  handler: removeExternalTeacher
});
