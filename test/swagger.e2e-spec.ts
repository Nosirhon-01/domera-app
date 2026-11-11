import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { createTestApp } from './utils';

// Builds the same OpenAPI document as main.ts and checks the contract the Flutter app relies on.
describe('Swagger document (e2e)', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  const dataRef = (path: string, method: string, status: string) =>
    (doc.paths[path] as any)[method].responses[status].content['application/json'].schema.properties.data.$ref;
  const props = (name: string) => Object.keys((doc.components!.schemas![name] as any).properties);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
  });
  afterAll(() => app.close());

  it('documents the 3-step phone registration requests and responses', () => {
    const body = (path: string) => (doc.paths[path] as any).post.requestBody.content['application/json'].schema.$ref;
    const codes = (path: string) => Object.keys((doc.paths[path] as any).post.responses);

    expect(body('/api/auth/register/request-code')).toBe('#/components/schemas/RegisterRequestCodeDto');
    expect(dataRef('/api/auth/register/request-code', 'post', '200')).toBe('#/components/schemas/RegisterCodeResponseDto');
    expect(codes('/api/auth/register/request-code')).toEqual(expect.arrayContaining(['200', '400', '409', '429']));

    expect(body('/api/auth/register/verify-code')).toBe('#/components/schemas/RegisterVerifyCodeDto');
    expect(dataRef('/api/auth/register/verify-code', 'post', '200')).toBe('#/components/schemas/RegisterVerifyResponseDto');
    expect(codes('/api/auth/register/verify-code')).toEqual(expect.arrayContaining(['200', '400']));

    expect(body('/api/auth/register/complete')).toBe('#/components/schemas/RegisterCompleteDto');
    expect(dataRef('/api/auth/register/complete', 'post', '201')).toBe('#/components/schemas/AuthSessionResponseDto');
    expect(codes('/api/auth/register/complete')).toEqual(expect.arrayContaining(['201', '400', '409']));

    expect(props('RegisterCodeResponseDto')).toEqual(
      expect.arrayContaining(['phone', 'expiresIn', 'retryAfter', 'devCode']),
    );
    expect(props('RegisterVerifyCodeDto')).toEqual(expect.arrayContaining(['phone', 'code']));
    expect(props('RegisterCompleteDto')).toEqual(
      expect.arrayContaining(['verificationToken', 'password', 'passwordConfirmation', 'name']),
    );
    expect(props('ErrorResponseDto')).toEqual(expect.arrayContaining(['success', 'message', 'error', 'retryAfter']));
  });

  it('documents phone sign-in /auth/otp/send and /auth/otp/verify', () => {
    const body = (path: string) => (doc.paths[path] as any).post.requestBody.content['application/json'].schema.$ref;
    expect(body('/api/auth/otp/send')).toBe('#/components/schemas/OtpSendDto');
    expect(dataRef('/api/auth/otp/send', 'post', '200')).toBe('#/components/schemas/RegisterCodeResponseDto');
    expect(body('/api/auth/otp/verify')).toBe('#/components/schemas/OtpVerifyDto');
    expect(dataRef('/api/auth/otp/verify', 'post', '200')).toBe('#/components/schemas/OtpVerifyResponseDto');
    expect(props('OtpVerifyResponseDto')).toEqual(
      expect.arrayContaining(['accessToken', 'refreshToken', 'user', 'isNewUser', 'needsName']),
    );
    expect(Object.keys((doc.paths['/api/auth/otp/send'] as any).post.responses)).toEqual(
      expect.arrayContaining(['200', '400', '429', '502', '503']),
    );
  });

  it('documents login/register with the same session shape', () => {
    expect(dataRef('/api/auth/login', 'post', '200')).toBe('#/components/schemas/AuthSessionResponseDto');
    expect(dataRef('/api/auth/register', 'post', '201')).toBe('#/components/schemas/AuthSessionResponseDto');
    expect(dataRef('/api/auth/refresh', 'post', '200')).toBe('#/components/schemas/AuthSessionResponseDto');
  });

  it('documents POST /properties as authenticated and free', () => {
    const create = (doc.paths['/api/properties'] as any).post;
    expect(create.security).toEqual([{ bearer: [] }]);
    expect(create.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/CreatePropertyDto');
    expect(dataRef('/api/properties', 'post', '201')).toBe('#/components/schemas/PropertyResponseDto');
    expect(create.description).toMatch(/no payment/i);
    expect(Object.keys(create.responses)).not.toContain('402');
  });
});
