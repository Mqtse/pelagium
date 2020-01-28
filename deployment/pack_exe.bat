set srcdir=C:\tmp\eludi\pelagium
set dest=pack

rem rcedit.exe pelagium.exe --set-version-string FileDescription "PELAGIUM" --set-version-string ProductName "PELAGIUM" --set-version-string LegalCopyright "(c) 2020 by eludi.net, all rights reserved" --set-version-string OriginalFilename "pelagium.exe" --set-product-version "20200127" --set-file-version "20200127" --set-icon %srcdir%\promotion\pelagium_origins.256.ico

md %dest%
xcopy %srcdir%\main.js %dest% /d
xcopy %srcdir%\package.json %dest% /d
xcopy %srcdir%\media %dest%\media /d /i
xcopy %srcdir%\static %dest%\static /d /i
del %dest%\static\ai.html %dest%\static\serviceworker.js %dest%\static\sim_proxy.js /q

del resources\app.asar /q
call asar pack %dest% resources/app.asar

rd %dest% /q /s
del resources\default_app.asar /q
