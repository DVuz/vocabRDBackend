import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  
  const allowedOrigins = [
    'http://localhost:5173',      // Local development
    'http://localhost:3000',      // Alternative local port
    'https://vocab.vtd26.io.vn',   // Production frontend origin
    process.env.FRONTEND_URL,
    process.env.EXTENSION_ORIGIN,
  ].filter(Boolean);
  
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformResponseInterceptor(new Reflector()));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('VocabBe API')
    .setDescription('API documentation')
    .setVersion('1.0')

    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server started on port ${port}`);
  console.log(`Swagger docs: http://localhost:${port}/docs`);
}
bootstrap();
