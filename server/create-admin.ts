
import { storage } from './storage.js';
import { hashPassword } from './auth.js';
import type { InsertUser } from '@shared/schema';

async function createNewAdminUser() {
  try {
    console.log('🔧 새 관리자 계정을 생성합니다...\n');
    
    // 관리자 계정 정보
    const adminData = {
      username: 'admin',
      email: 'hello@readacross.io',
      password: 'Admin123!@#'
    };

    // 기존 계정 중복 확인
    const existingByUsername = await storage.getUserByUsername(adminData.username);
    if (existingByUsername) {
      console.log(`❌ 사용자명 '${adminData.username}'이 이미 존재합니다.`);
      console.log(`기존 사용자 정보: ID ${existingByUsername.id}, 이메일: ${existingByUsername.email}, 역할: ${existingByUsername.role}`);
      
      if (existingByUsername.role !== 'admin') {
        console.log('🔄 기존 사용자를 관리자로 업그레이드합니다...');
        await storage.updateUser(existingByUsername.id, { role: 'admin', plan: 'admin' });
        console.log(`✅ 사용자 '${existingByUsername.username}'이 관리자로 업그레이드되었습니다.`);
      } else {
        // Ensure admin users have admin plan for full feature access
        if (existingByUsername.plan !== 'admin') {
          await storage.updateUser(existingByUsername.id, { plan: 'admin' });
          console.log('✅ 관리자 플랜으로 업그레이드되었습니다.');
        }
        console.log('ℹ️  이미 관리자 권한을 가지고 있습니다.');
      }
      return;
    }

    const existingByEmail = await storage.getUserByEmail(adminData.email);
    if (existingByEmail) {
      console.log(`❌ 이메일 '${adminData.email}'이 이미 존재합니다.`);
      console.log(`기존 사용자 정보: ID ${existingByEmail.id}, 사용자명: ${existingByEmail.username}, 역할: ${existingByEmail.role}`);
      
      if (existingByEmail.role !== 'admin') {
        console.log('🔄 기존 사용자를 관리자로 업그레이드합니다...');
        await storage.updateUser(existingByEmail.id, { role: 'admin', plan: 'admin' });
        console.log(`✅ 사용자 '${existingByEmail.username}'이 관리자로 업그레이드되었습니다.`);
      } else {
        // Ensure admin users have admin plan for full feature access
        if (existingByEmail.plan !== 'admin') {
          await storage.updateUser(existingByEmail.id, { plan: 'admin' });
          console.log('✅ 관리자 플랜으로 업그레이드되었습니다.');
        }
        console.log('ℹ️  이미 관리자 권한을 가지고 있습니다.');
      }
      return;
    }

    // 비밀번호 해시화
    console.log('🔒 비밀번호를 해시화합니다...');
    const hashedPassword = await hashPassword(adminData.password);

    // 새 관리자 계정 생성
    const newAdmin: InsertUser = {
      username: adminData.username,
      email: adminData.email,
      password: hashedPassword,
      role: 'admin',
      plan: 'admin', // Admin users get full feature access
      status: 'active',
      emailVerifiedAt: new Date(), // 관리자는 이메일 인증 완료로 설정
      failedAttempts: 0,
      passwordVersion: 1
    };

    console.log('👤 새 관리자 계정을 생성합니다...');
    const createdAdmin = await storage.createUser(newAdmin);

    console.log('\n✅ 관리자 계정이 성공적으로 생성되었습니다!');
    console.log('======================================');
    console.log(`👤 사용자명: ${createdAdmin.username}`);
    console.log(`📧 이메일: ${createdAdmin.email}`);
    console.log(`🔒 역할: ${createdAdmin.role}`);
    console.log(`🆔 사용자 ID: ${createdAdmin.id}`);
    console.log('======================================');
    console.log('\n⚠️  보안을 위해 첫 로그인 후 비밀번호를 변경해주세요.');
    console.log('🌐 관리자 페이지: /admin-new');
    
  } catch (error) {
    console.error('❌ 관리자 계정 생성 중 오류가 발생했습니다:', error);
    process.exit(1);
  }
}

// 스크립트 실행
createNewAdminUser()
  .then(() => {
    console.log('\n🎉 작업이 완료되었습니다.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  });
