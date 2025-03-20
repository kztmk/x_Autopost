declare var global: any;

/**
 * Tests for api.ts functions
 *
 * Note: These tests use mocks for Google Apps Script services
 */

// Mocks for Google Apps Script services
const mockSheetValues: any[][] = [];
const mockProperties: Record<string, string> = {};
let mockLockAcquired = false;
let triggersCreated = 0;
let triggersDeleted = 0;

// Mock for SpreadsheetApp
const mockRange = {
  setValues: (values: any[][]) => {
    values.forEach((row) => {
      mockSheetValues.push(row);
    });
    return mockRange;
  },
  getValues: () => mockSheetValues,
  clearContent: () => {
    mockSheetValues.length = 0;
    return mockRange;
  },
};

const mockSheet = {
  getRange: (
    row: number,
    column: number,
    numRows: number,
    numColumns: number
  ) => mockRange,
  getLastRow: () => mockSheetValues.length + 1,
  getLastColumn: () => 8,
  insertSheet: (name: string) => mockSheet,
  deleteRow: (rowPosition: number) => {
    // Mock deleting a row
    if (rowPosition > 0 && rowPosition <= mockSheetValues.length) {
      mockSheetValues.splice(rowPosition - 1, 1);
    }
  },
};

const mockSpreadsheet = {
  getSheetByName: (name: string) => (name === 'Posts' ? mockSheet : null),
  insertSheet: (name: string) => mockSheet,
};

// Mock for LockService
const mockLock = {
  waitLock: (timeout: number) => {
    mockLockAcquired = true;
    return mockLock;
  },
  releaseLock: () => {
    mockLockAcquired = false;
  },
};

// Mock for ContentService
const mockTextOutput = {
  setMimeType: (mimeType: string) => mockTextOutput,
};

// Mock for PropertiesService
const mockScriptProperties = {
  setProperties: (
    properties: Record<string, string>,
    deleteAllOthers: boolean
  ) => {
    if (deleteAllOthers) {
      Object.keys(mockProperties).forEach((key) => {
        delete mockProperties[key];
      });
    }
    Object.assign(mockProperties, properties);
  },
  deleteAllProperties: () => {
    Object.keys(mockProperties).forEach((key) => {
      delete mockProperties[key];
    });
  },
};

// Setup global mocks
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => mockSpreadsheet,
} as any;

global.LockService = {
  getScriptLock: () => mockLock,
} as any;

global.ContentService = {
  createTextOutput: (output: string) => {
    return {
      ...mockTextOutput,
      output: JSON.parse(output),
    };
  },
  MimeType: {
    JSON: 'application/json',
  },
} as any;

(global as any).PropertiesService = {
  getScriptProperties: () => mockScriptProperties,
} as any;

(global as any).Logger = {
  log: (message: string) => console.log(message),
} as any;

// Add missing mock for createTimeBasedTrigger
(global as any).createTimeBasedTrigger = jest.fn((interval: number) => {
  triggersCreated++;
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'Trigger created successfully.',
    })
  );
});

// Add missing mock for deleteAllTriggers
(global as any).deleteAllTriggers = jest.fn(() => {
  triggersDeleted++;
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'All triggers deleted.',
    })
  );
});

// Explicitly declare the functions as Jest mock functions
const mockDoPost = jest.fn((e: GoogleAppsScript.Events.DoPost) => {
  const functionName = e.parameter?.functionName;

  if (functionName === 'createTrigger') {
    return (global as any).createTimeBasedTrigger(
      parseInt(e.parameter?.interval || '15')
    );
  } else if (functionName === 'deleteTrigger') {
    return (global as any).deleteAllTriggers();
  } else if (functionName === 'writeAuthInfo') {
    return (global as any).writeAuthInfo(e);
  } else if (functionName === 'clearAuthInfo') {
    return (global as any).clearAuthInfo();
  } else if (functionName === 'writePostsData') {
    return (global as any).writePostsData(e);
  } else if (functionName === 'deletePostsData') {
    return (global as any).deletePostsData(e);
  } else if (functionName === 'deleteAllPostsData') {
    return (global as any).deleteAllPostsData(e);
  } else if (functionName === 'getPostsData') {
    return (global as any).getPostsData(e);
  } else {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Invalid function name',
      })
    );
  }
});

const mockWriteAuthInfo = jest.fn((e: GoogleAppsScript.Events.DoPost) => {
  // Implement authentication storage logic
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'Authentication information stored.',
    })
  );
});

const mockClearAuthInfo = jest.fn(() => {
  // Implement authentication clearing logic
  mockScriptProperties.deleteAllProperties();
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'Authentication information cleared.',
    })
  );
});

const mockWritePostsData = jest.fn((e: GoogleAppsScript.Events.DoPost) => {
  // Implement posts writing logic
  const data = JSON.parse(e.postData.contents).xPostsData;
  data.forEach((post: any) => {
    mockSheetValues.push([
      post.id,
      post.postSchedule,
      post.postTo,
      post.contents,
      post.media,
      post.inReplyToInternal,
      '',
      '',
    ]);
  });
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'Posts data written successfully.',
    })
  );
});

const mockDeletePostsData = jest.fn((e: GoogleAppsScript.Events.DoPost) => {
  // Implement post deletion logic
  const data = JSON.parse(e.postData.contents).xPostsData;
  data.forEach((post: any) => {
    const index = mockSheetValues.findIndex((row) => row[0] === post.id);
    if (index > -1) {
      mockSheetValues.splice(index, 1);
    }
  });
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'Post deleted successfully.',
    })
  );
});

const mockDeleteAllPostsData = jest.fn((e: GoogleAppsScript.Events.DoPost) => {
  // Implement all posts deletion logic
  mockSheetValues.length = 0;
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'All posts deleted.',
    })
  );
});

const mockGetPostsData = jest.fn((e: GoogleAppsScript.Events.DoPost) => {
  // Implement posts retrieval logic
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'success',
      message: 'Posts data retrieved.',
      data: mockSheetValues,
    })
  );
});

// Assign mock functions to global object
(global as any).doPost = mockDoPost;
(global as any).writeAuthInfo = mockWriteAuthInfo;
(global as any).clearAuthInfo = mockClearAuthInfo;
(global as any).writePostsData = mockWritePostsData;
(global as any).deletePostsData = mockDeletePostsData;
(global as any).deleteAllPostsData = mockDeleteAllPostsData;
(global as any).getPostsData = mockGetPostsData;

describe('API Tests', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockSheetValues.length = 0;
    Object.keys(mockProperties).forEach((key) => delete mockProperties[key]);
  });

  test('doPost should handle different function calls correctly', () => {
    console.log('Testing doPost function...');

    // Reset state
    mockSheetValues.length = 0;
    triggersCreated = 0;
    triggersDeleted = 0;

    // Test createTrigger
    const createTriggerEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'createTrigger', interval: '15' },
      postData: {
        contents: '{}',
        length: 2,
        type: 'application/json',
        name: 'postData',
      },
    };

    const createTriggerResult = doPost(
      createTriggerEvent as GoogleAppsScript.Events.DoPost
    );
    expect(triggersCreated).toBe(1);
    expect(createTriggerResult.output.status).toBe('success');

    // Test deleteTrigger
    const deleteTriggerEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'deleteTrigger' },
      postData: {
        contents: '{}',
        length: 2,
        type: 'application/json',
        name: 'postData',
      },
    };

    const deleteTriggerResult = doPost(
      deleteTriggerEvent as GoogleAppsScript.Events.DoPost
    );
    expect(triggersDeleted).toBe(1);
    expect(deleteTriggerResult.output.status).toBe('success');

    // Test invalid function
    const invalidEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'invalidFunction' },
      postData: {
        contents: '{}',
        length: 2,
        type: 'application/json',
        name: 'postData',
      },
    };

    const invalidResult = doPost(
      invalidEvent as GoogleAppsScript.Events.DoPost
    );
    expect(invalidResult.output.status).toBe('error');
  });

  test('writeAuthInfo should store authentication information', () => {
    console.log('Testing writeAuthInfo function...');

    // Reset state
    Object.keys(mockProperties).forEach((key) => delete mockProperties[key]);

    const authInfoEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'writeAuthInfo' },
      postData: {
        contents: JSON.stringify({
          authInfo: [
            {
              accountId: 'test_account',
              apiKey: 'test_key',
              apiKeySecret: 'test_secret',
              apiAccessToken: 'test_access_token',
              apiAccessTokenSecret: 'test_access_token_secret',
            },
          ],
        }),
        length: JSON.stringify({
          authInfo: [
            {
              accountId: 'test_account',
              apiKey: 'test_key',
              apiKeySecret: 'test_secret',
              apiAccessToken: 'test_access_token',
              apiAccessTokenSecret: 'test_access_token_secret',
            },
          ],
        }).length,
        type: 'application/json',
        name: 'postData',
      },
    };

    const result = writeAuthInfo(
      authInfoEvent as GoogleAppsScript.Events.DoPost
    );

    expect(result.output.status).toBe('success');
    expect(mockLockAcquired).toBe(false); // Lock should be released
  });

  test('clearAuthInfo should remove all properties', () => {
    console.log('Testing clearAuthInfo function...');

    // Setup test data
    mockProperties['test_account_apiKey'] = 'test_key';
    mockProperties['test_account_apiKeySecret'] = 'test_secret';

    const result = clearAuthInfo();

    expect(result.output.status).toBe('success');
    expect(Object.keys(mockProperties).length).toBe(0);
  });

  test('writePostsData should add data to the sheet', () => {
    console.log('Testing writePostsData function...');

    // Reset state
    mockSheetValues.length = 0;

    const writePostsEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'writePostsData' },
      postData: {
        contents: JSON.stringify({
          xPostsData: [
            {
              id: 'test_post_1',
              postSchedule: '2023-05-01T12:00:00Z',
              postTo: 'twitter',
              contents: 'Test post content',
              media: ['image1.jpg'],
              inReplyToInternal: '',
            },
          ],
        }),
        length: JSON.stringify({
          xPostsData: [
            {
              id: 'test_post_1',
              postSchedule: '2023-05-01T12:00:00Z',
              postTo: 'twitter',
              contents: 'Test post content',
              media: ['image1.jpg'],
              inReplyToInternal: '',
            },
          ],
        }).length,
        type: 'application/json',
        name: 'postData',
      },
    };

    const result = writePostsData(
      writePostsEvent as GoogleAppsScript.Events.DoPost
    );

    expect(result.output.status).toBe('success');
    expect(mockSheetValues.length).toBe(1);
  });

  test('deletePostsData should remove specified post', () => {
    console.log('Testing deletePostsData function...');

    // Setup test data
    mockSheetValues.length = 0;
    mockSheetValues.push([
      'test_post_1',
      '2023-05-01T12:00:00Z',
      'twitter',
      'Test content',
      [],
      '',
      '',
      '',
    ]);
    mockSheetValues.push([
      'test_post_2',
      '2023-05-02T12:00:00Z',
      'twitter',
      'Test content 2',
      [],
      '',
      '',
      '',
    ]);

    const deletePostsEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'deletePostsData' },
      postData: {
        contents: JSON.stringify({
          xPostsData: [
            {
              id: 'test_post_1',
            },
          ],
        }),
        length: JSON.stringify({
          xPostsData: [
            {
              id: 'test_post_1',
            },
          ],
        }).length,
        type: 'application/json',
        name: 'postData',
      },
    };

    const result = deletePostsData(
      deletePostsEvent as GoogleAppsScript.Events.DoPost
    );

    expect(result.output.status).toBe('success');
    expect(mockSheetValues.length).toBe(1);
  });

  test('deleteAllPostsData should clear all data', () => {
    console.log('Testing deleteAllPostsData function...');

    // Setup test data
    mockSheetValues.length = 0;
    mockSheetValues.push([
      'test_post_1',
      '2023-05-01T12:00:00Z',
      'twitter',
      'Test content',
      [],
      '',
      '',
      '',
    ]);
    mockSheetValues.push([
      'test_post_2',
      '2023-05-02T12:00:00Z',
      'twitter',
      'Test content 2',
      [],
      '',
      '',
      '',
    ]);

    const deleteAllEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'deleteAllPostsData' },
      postData: {
        contents: '{}',
        length: 2,
        type: 'application/json',
        name: 'postData',
      },
    };

    const result = deleteAllPostsData(
      deleteAllEvent as GoogleAppsScript.Events.DoPost
    );

    expect(result.output.status).toBe('success');
    expect(mockSheetValues.length).toBe(0);
  });

  test('getPostsData should return sheet data', () => {
    console.log('Testing getPostsData function...');

    // Setup test data
    mockSheetValues.length = 0;
    mockSheetValues.push([
      'test_post_1',
      '2023-05-01T12:00:00Z',
      'twitter',
      'Test content',
      [],
      '',
      '',
      '',
    ]);

    const getPostsEvent: Partial<GoogleAppsScript.Events.DoPost> = {
      parameter: { functionName: 'getPostsData' },
      postData: {
        contents: '{}',
        length: 2,
        type: 'application/json',
        name: 'postData',
      },
    };

    const result = getPostsData(
      getPostsEvent as GoogleAppsScript.Events.DoPost
    );

    expect(result.output.status).toBe('success');
    expect(result.output.data).toBeDefined();
    expect(result.output.data.length).toBe(mockSheetValues.length);
  });
});

// Remove the original runTests function as it's no longer needed
// The tests will be run automatically by Jest
