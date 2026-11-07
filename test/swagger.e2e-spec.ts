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

  it('documents OTP send/verify requests and responses', () => {
    const send = (doc.paths['/api/auth/otp/send'] as any).post;
    expect(send.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/SendOtpDto');
    expect(dataRef('/api/auth/otp/send', 'post', '200')).toBe('#/components/schemas/OtpSendResponseDto');
    expect(Object.keys(send.responses)).toEqual(expect.arrayContaining(['200', '400', '429', '503']));

    const verify = (doc.paths['/api/auth/otp/verify'] as any).post;
    expect(verify.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/VerifyOtpDto');
    expect(dataRef('/api/auth/otp/verify', 'post', '200')).toBe('#/components/schemas/OtpVerifyResponseDto');
    expect(Object.keys(verify.responses)).toEqual(expect.arrayContaining(['200', '400', '401']));

    expect(props('VerifyOtpDto')).toEqual(expect.arrayContaining(['phone', 'code', 'name']));
    expect(props('OtpVerifyResponseDto')).toEqual(
      expect.arrayContaining(['accessToken', 'refreshToken', 'user', 'isNewUser']),
    );
    expect(props('ErrorResponseDto')).toEqual(expect.arrayContaining(['success', 'message', 'error', 'retryAfter']));
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
