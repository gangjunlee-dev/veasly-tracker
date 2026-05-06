# Extractor Template

To add a new shopping mall extractor:

1. Copy this folder.
2. Rename it to the site code.
   Example:
   src/main/extractors/yourmall/

3. Update config.json:
   code: yourmall
   name: Your Mall
   loginUrl: https://yourmall.example/login
   ordersUrl: https://yourmall.example/orders

4. Update selectors.ts.
5. Implement login behavior in login.ts.
6. Implement order parsing in parser.ts.
7. Keep all site-specific logic inside this folder.

CAPTCHA / OTP:
Use headful Playwright. If CAPTCHA or OTP is detected, call page.pause().
The user can solve the challenge manually.

Every extractor must return StandardOrder[].

Required fields:
- orderNumber
- orderDate
- productName
- quantity
- amount

Recommended:
- invoiceNumber
- invoiceUrl
- shippingStatus
- rawData
